/**
 * Client-side validation for an entry. The same limits are enforced again
 * server-side in firebase/firestore.rules — the browser check is for UX only.
 */
import { evaluateExpression, isValidISODate, todayISO, addDays } from './utils.js';
import { CONFIG } from './config.js';

export const LIMITS = { title: 120, vendor: 120, client: 80, project: 80, description: 1000, notes: 2000, category: 60, maxAmount: 100000000 };

export function validateEntry(v, { categories = [] } = {}) {
  const errors = {};
  const calc = evaluateExpression(v.amount);
  if (calc.empty) errors.amount = 'Enter the amount';
  else if (!calc.ok) errors.amount = calc.error;
  else if (calc.value <= 0) errors.amount = 'Amount must be more than ₹0';
  else if (calc.value > LIMITS.maxAmount) errors.amount = 'Amount looks too large — check the number';

  if (!v.date) errors.date = 'Pick the date of payment';
  else if (!isValidISODate(v.date)) errors.date = 'Invalid date';
  else if (v.date > addDays(todayISO(), 1)) errors.date = 'Date cannot be in the future';
  else if (v.date < '2000-01-01') errors.date = 'Date looks too old';

  if (!['expense', 'income'].includes(v.type)) errors.type = 'Choose expense or income';
  if (!v.title?.trim()) errors.title = 'Give this entry a short title';
  else if (v.title.trim().length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters`;
  if (!v.category) errors.category = 'Choose a category';
  else if (categories.length && !categories.includes(v.category)) errors.category = 'Unknown category';
  if (!v.paymentMethod) errors.paymentMethod = 'Choose how it was paid';
  else if (!CONFIG.paymentMethods.includes(v.paymentMethod)) errors.paymentMethod = 'Unknown payment method';
  if (v.gstRate && !CONFIG.gstRates.includes(Number(v.gstRate))) errors.gstRate = 'Unknown GST rate';

  return { valid: Object.keys(errors).length === 0, errors, amount: calc.ok ? calc.value : null };
}
