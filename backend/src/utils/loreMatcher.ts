import { countTokens } from './tokenCounter.js';

interface LoreEntry {
  uid: number;
  key: string[];
  optional_filter?: string[];
  title_memo?: string;
  content: string;
  constant?: boolean;
  selective?: boolean;
  selectiveLogic?: number; // 0=AND ANY, 1=AND ALL, 2=NOT ANY, 3=NOT ALL
  insertion_order?: number;
  insertion_position?: string;
  outletName?: string;
  enabled?: boolean;
  preventRecursion?: boolean;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  vectorized?: boolean;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  useGroupScoring?: boolean;
  automationId?: string;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  triggers?: string[];
  additional_matching_sources?: string[];
  extensions?: Record<string, any>;
}

interface LoreContext {
  text: string; // The text to scan for keywords
  activeCharacters?: string[]; // For filters
  // Add other context as needed
}

interface MatchedEntry extends LoreEntry {
  matchedKeys: string[];
  score?: number;
}

interface LoreMatcherResult {
  selectedEntries: MatchedEntry[];
  totalTokens: number;
}

/**
 * Matches lore entries against context text based on keywords, filters, and rules.
 * @param entries Array of lore entries to match
 * @param context The context containing text to scan and other metadata
 * @param scanDepth Not used yet, for future recursion
 * @param tokenBudget Maximum tokens for selected entries
 * @returns Selected entries and total token cost
 */
export function matchLoreEntries(
  entries: LoreEntry[],
  context: LoreContext,
  scanDepth: number = 4,
  tokenBudget: number = 2048
): LoreMatcherResult {
  const text = context.text.toLowerCase(); // Normalize for case-insensitive matching unless specified
  const selected: MatchedEntry[] = [];
  let totalTokens = 0;

  // Group entries by group for selection
  const grouped: { [group: string]: MatchedEntry[] } = {};

  for (const entry of entries) {
    if (!entry.enabled) continue;

    const matches = matchEntry(entry, text, context);
    if (matches.length > 0) {
      const matchedEntry: MatchedEntry = { ...entry, matchedKeys: matches };
      if (entry.group) {
        if (!grouped[entry.group]) grouped[entry.group] = [];
        grouped[entry.group].push(matchedEntry);
      } else {
        selected.push(matchedEntry);
      }
    }
  }

  // Process groups: select one per group
  for (const groupEntries of Object.values(grouped)) {
    if (groupEntries.length > 0) {
      // Sort by insertion_order, then score
      groupEntries.sort((a, b) => {
        if (a.insertion_order !== b.insertion_order) return (a.insertion_order || 100) - (b.insertion_order || 100);
        return (b.score || 0) - (a.score || 0);
      });
      selected.push(groupEntries[0]); // Take the top one
    }
  }

  // Sort selected by insertion_order
  selected.sort((a, b) => (a.insertion_order || 100) - (b.insertion_order || 100));

  // Apply token budget
  const finalSelected: MatchedEntry[] = [];
  for (const entry of selected) {
    const entryTokens = countTokens(entry.content);
    if (totalTokens + entryTokens <= tokenBudget) {
      finalSelected.push(entry);
      totalTokens += entryTokens;
    } else {
      break;
    }
  }

  return { selectedEntries: finalSelected, totalTokens };
}

/**
 * Checks if an entry matches the context text.
 * @param entry The lore entry
 * @param text The normalized text to scan
 * @param context Additional context
 * @returns Array of matched keys
 */
function matchEntry(entry: LoreEntry, text: string, context: LoreContext): string[] {
  const matchedKeys: string[] = [];

  // Check primary keys
  for (const key of entry.key) {
    if (matchesKey(key, text, entry)) {
      matchedKeys.push(key);
    }
  }

  if (matchedKeys.length === 0) return [];

  // If selective, check optional_filter
  if (entry.selective && entry.optional_filter) {
    const filterMatches = entry.optional_filter.filter(filter => matchesKey(filter, text, entry));
    const logic = entry.selectiveLogic || 0;
    const passes = checkSelectiveLogic(filterMatches.length, entry.optional_filter.length, logic);
    if (!passes) return [];
  }

  // Probability check
  if (entry.useProbability && entry.probability !== undefined) {
    if (Math.random() * 100 > entry.probability) return [];
  }

  return matchedKeys;
}

/**
 * Checks if a key matches in the text.
 * @param key The key (string or regex)
 * @param text The text to search
 * @param entry The entry for options
 * @returns True if matches
 */
function matchesKey(key: string, text: string, entry: LoreEntry): boolean {
  let pattern: RegExp;
  if (key.startsWith('/') && key.endsWith('/')) {
    // Regex key
    const regexBody = key.slice(1, -1);
    const flags = entry.caseSensitive ? 'g' : 'gi';
    pattern = new RegExp(regexBody, flags);
  } else {
    // Plaintext
    let escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (entry.matchWholeWords) {
      escaped = `\\b${escaped}\\b`;
    }
    const flags = entry.caseSensitive ? 'g' : 'gi';
    pattern = new RegExp(escaped, flags);
  }

  return pattern.test(text);
}

/**
 * Checks selective logic.
 * @param matched Number of filters matched
 * @param total Total filters
 * @param logic 0=ANY, 1=ALL, 2=NONE, 3=NOT ALL
 * @returns True if passes
 */
function checkSelectiveLogic(matched: number, total: number, logic: number): boolean {
  switch (logic) {
    case 0: return matched > 0; // ANY
    case 1: return matched === total; // ALL
    case 2: return matched === 0; // NONE
    case 3: return matched < total; // NOT ALL
    default: return true;
  }
}