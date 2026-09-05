import type { Clue, GameConfig } from './types';
import { DEFAULT_FINAL_JEOPARDY } from './types';

export function createEmptyClues(): Clue[] {
  return [200, 400, 600, 800, 1000].map((value) => ({
    value,
    answer: '',
    question: '',
    played: false,
    dailyDouble: false,
  }));
}

export function createBlankGame(playerCount = 3): GameConfig {
  const categories = Array.from({ length: 6 }, (_, i) => ({
    name: `Category ${i + 1}`,
    clues: createEmptyClues(),
  }));
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    score: 0,
  }));
  return {
    categories,
    players,
    finalJeopardy: { ...DEFAULT_FINAL_JEOPARDY },
  };
}

export function createDemoGame(): GameConfig {
  return {
    players: [
      { id: 'p1', name: 'Alex', score: 0 },
      { id: 'p2', name: 'Jordan', score: 0 },
      { id: 'p3', name: 'Sam', score: 0 },
    ],
    finalJeopardy: {
      category: 'WORLD HISTORY',
      answer: 'This wall fell in 1989, symbolizing the end of the Cold War in Europe',
      question: 'What is the Berlin Wall?',
    },
    categories: [
      {
        name: 'WORLD CAPITALS',
        clues: [
          { value: 200, answer: 'This city on the Seine is home to the Louvre', question: 'What is Paris?', played: false },
          { value: 400, answer: 'Japan\'s capital was once called Edo', question: 'What is Tokyo?', played: false },
          { value: 600, answer: 'This South American capital sits nearly 2 miles above sea level', question: 'What is La Paz?', played: false },
          { value: 800, answer: 'The Blue Mosque and Hagia Sophia are landmarks in this city that spans two continents', question: 'What is Istanbul?', played: false },
          { value: 1000, answer: 'This capital of New Zealand is named after a British duke', question: 'What is Wellington?', played: false },
        ],
      },
      {
        name: 'SCIENCE',
        clues: [
          { value: 200, answer: 'H2O is the chemical formula for this', question: 'What is water?', played: false },
          { value: 400, answer: 'This planet is known for its prominent ring system', question: 'What is Saturn?', played: false },
          {
            value: 600,
            answer: 'DNA stands for this acid',
            question: 'What is deoxyribonucleic acid?',
            played: false,
            dailyDouble: true,
          },
          { value: 800, answer: 'This subatomic particle has a positive charge', question: 'What is a proton?', played: false },
          { value: 1000, answer: 'The speed of light in a vacuum is approximately this many meters per second', question: 'What is 300 million (or 3×10^8)?', played: false },
        ],
      },
      {
        name: 'MOVIES',
        clues: [
          { value: 200, answer: 'In 1997, this ship sank... again, on the big screen', question: 'What is Titanic?', played: false },
          { value: 400, answer: 'This 1939 classic ends with "There\'s no place like home"', question: 'What is The Wizard of Oz?', played: false },
          { value: 600, answer: 'Tom Hanks won an Oscar for playing a simple man in this 1994 film', question: 'What is Forrest Gump?', played: false },
          { value: 800, answer: 'This Christopher Nolan film features dream within a dream within a dream', question: 'What is Inception?', played: false },
          { value: 1000, answer: 'This 1941 Orson Welles film is often called the greatest ever made', question: 'What is Citizen Kane?', played: false },
        ],
      },
      {
        name: 'LITERATURE',
        clues: [
          { value: 200, answer: 'This bard wrote Romeo and Juliet', question: 'Who is William Shakespeare?', played: false },
          { value: 400, answer: 'George Orwell\'s dystopian novel featuring Big Brother', question: 'What is 1984?', played: false },
          { value: 600, answer: 'This J.R.R. Tolkien trilogy follows Frodo\'s quest to destroy a ring', question: 'What is The Lord of the Rings?', played: false },
          { value: 800, answer: 'Harper Lee\'s novel about Atticus Finch and racial injustice', question: 'What is To Kill a Mockingbird?', played: false },
          { value: 1000, answer: 'This Russian novel by Tolstoy shares its name with a period of conflict', question: 'What is War and Peace?', played: false },
        ],
      },
      {
        name: 'SPORTS',
        clues: [
          { value: 200, answer: 'This sport is played at Wimbledon', question: 'What is tennis?', played: false },
          { value: 400, answer: 'The Super Bowl is the championship of this league', question: 'What is the NFL?', played: false },
          { value: 600, answer: 'Michael Jordan won 6 NBA titles with this team', question: 'What are the Chicago Bulls?', played: false },
          { value: 800, answer: 'This Olympic event combines swimming, cycling, and running', question: 'What is a triathlon?', played: false },
          { value: 1000, answer: 'This cricket term for a score of zero sounds like a waterfowl', question: 'What is a duck?', played: false },
        ],
      },
      {
        name: 'FOOD & DRINK',
        clues: [
          { value: 200, answer: 'This Italian dish traditionally tops flatbread with tomato and mozzarella', question: 'What is pizza?', played: false },
          { value: 400, answer: 'Espresso with steamed milk foam is called this', question: 'What is a cappuccino?', played: false },
          { value: 600, answer: 'Sushi originated in this country', question: 'What is Japan?', played: false },
          { value: 800, answer: 'This French wine region is famous for sparkling wine', question: 'What is Champagne?', played: false },
          { value: 1000, answer: 'Saffron comes from the stigma of this flower', question: 'What is the crocus?', played: false },
        ],
      },
    ],
  };
}
