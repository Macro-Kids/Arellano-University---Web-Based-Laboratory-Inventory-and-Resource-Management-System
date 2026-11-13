// lookups.js — small reference lists (categories, laboratories) cached for the session.
import { categoriesApi } from '../services/index.js';
let cats = null;
export async function categories() { if (!cats) cats = await categoriesApi.list(); return cats; }
export const invalidateCategories = () => { cats = null; };
