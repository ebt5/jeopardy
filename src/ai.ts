import type { Category, FinalJeopardy } from './types';
import { CLUE_VALUES, DEFAULT_FINAL_JEOPARDY } from './types';

interface AiClue {
  value: number;
  answer: string;
  question: string;
  dailyDouble?: boolean;
}

interface AiCategory {
  name: string;
  clues: AiClue[];
}

interface AiResponse {
  categories: AiCategory[];
  finalJeopardy?: {
    category?: string;
    answer?: string;
    question?: string;
  };
}

export interface GenerateResult {
  categories: Category[];
  finalJeopardy: FinalJeopardy;
}

const SYSTEM_PROMPT = `You are a Jeopardy! game writer. Return ONLY valid JSON with this exact shape:
{"categories":[{"name":"CATEGORY NAME","clues":[{"value":200,"answer":"...","question":"...","dailyDouble":false},...]}],"finalJeopardy":{"category":"...","answer":"...","question":"..."}}

Rules:
- Exactly 6 categories, each with exactly 5 clues
- Clue values MUST be 200, 400, 600, 800, 1000 (one of each per category)
- "answer" is the Jeopardy clue text shown first (the statement/riddle)
- "question" is the correct response in the form "What is ...?" or "Who is ...?"
- Category names should be short and all-caps style
- Make clues progressively harder with higher values
- Mark EXACTLY ONE clue across the whole board with "dailyDouble": true (prefer a mid/high value like 600–1000). All other clues must omit dailyDouble or set it false.
- Include finalJeopardy with category, answer, and question (harder than board clues)
- No markdown, no commentary — JSON only`;

function placeOneDailyDouble(categories: Category[]): Category[] {
  const hasDd = categories.some((c) => c.clues.some((cl) => cl.dailyDouble));
  if (hasDd) return categories;
  const ci = Math.min(1, categories.length - 1);
  const qi = Math.min(2, categories[ci].clues.length - 1);
  return categories.map((cat, i) => {
    if (i !== ci) return cat;
    return {
      ...cat,
      clues: cat.clues.map((cl, j) =>
        j === qi ? { ...cl, dailyDouble: true } : { ...cl, dailyDouble: false },
      ),
    };
  });
}

export async function generateGame(
  apiKey: string,
  userPrompt: string,
): Promise<GenerateResult> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            userPrompt.trim() ||
            'Create a fun general-knowledge Jeopardy board with varied categories, one Daily Double, and Final Jeopardy.',
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let detail = errText;
    try {
      const j = JSON.parse(errText) as { error?: { message?: string } };
      detail = j.error?.message ?? errText;
    } catch {
      /* keep raw */
    }
    throw new Error(detail || `xAI API error (${res.status})`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from xAI');

  const parsed = JSON.parse(content) as AiResponse;
  if (!parsed.categories || parsed.categories.length !== 6) {
    throw new Error('AI response must include exactly 6 categories');
  }

  let ddAssigned = false;
  let categories: Category[] = parsed.categories.map((cat, i) => {
    const byValue = new Map(cat.clues.map((c) => [c.value, c]));
    const clues = CLUE_VALUES.map((value) => {
      const found = byValue.get(value);
      let dailyDouble = Boolean(found?.dailyDouble);
      if (dailyDouble) {
        if (ddAssigned) dailyDouble = false;
        else ddAssigned = true;
      }
      return {
        value,
        answer: found?.answer?.trim() || `Clue for $${value}`,
        question: found?.question?.trim() || `What is the $${value} answer?`,
        played: false,
        dailyDouble,
      };
    });
    return {
      name: (cat.name || `Category ${i + 1}`).toUpperCase(),
      clues,
    };
  });

  categories = placeOneDailyDouble(categories);

  const fjRaw = parsed.finalJeopardy;
  const finalJeopardy: FinalJeopardy = {
    category: (fjRaw?.category?.trim() || DEFAULT_FINAL_JEOPARDY.category).toUpperCase(),
    answer:
      fjRaw?.answer?.trim() ||
      'This is the Final Jeopardy answer — edit me in Setup',
    question: fjRaw?.question?.trim() || 'What is the Final Jeopardy response?',
  };

  return { categories, finalJeopardy };
}
