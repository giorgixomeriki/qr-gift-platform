import { customAlphabet } from "nanoid";

// Unambiguous alphabet (no 0/O/1/I/l) since these are printed on physical cards
// and may be hand-typed as a fallback if a QR won't scan. 24 chars over a 32-symbol
// alphabet is ~120 bits of entropy — not practically enumerable.
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const generatePublicToken = customAlphabet(alphabet, 24);
