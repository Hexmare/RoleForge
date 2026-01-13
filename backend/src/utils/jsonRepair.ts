// Utility wrapper for jsonrepair
import { jsonrepair } from 'jsonrepair';
export default function tryJsonRepair(input: string): string | null {
  try {
    return jsonrepair(input);
  } catch (e) {
    return null;
  }
}
