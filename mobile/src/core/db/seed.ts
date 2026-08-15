/**
 * Default lists a fresh install starts with, based on the user's manual tracker.
 * All of these are editable in-app later; this is just a helpful starting point.
 *
 * Pure data (no imports) so it can be validated by a unit test and reused on web.
 */

export interface SeedCategory {
  name: string;
  emoji: string;
  subcategories: string[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Food & Dining', emoji: '🍽️', subcategories: ['Restaurant', 'Biriyani', 'Dosa', 'Dominos', 'Tea', 'Juice', 'Cake', 'Snacks'] },
  { name: 'Groceries', emoji: '🛒', subcategories: ['Vegetables', 'Fruits', 'Curd', 'Milk', 'Eggs', 'Paneer'] },
  { name: 'Bike', emoji: '🏍️', subcategories: ['Fuel', 'Cover', 'Water wash', 'Service'] },
  { name: 'Car', emoji: '🚗', subcategories: ['Car EMI', 'Fuel', 'Service', 'FASTag'] },
  { name: 'Commute', emoji: '🚕', subcategories: ['Metro', 'Bus', 'Train', 'Auto'] },
  { name: 'Medicine & Health', emoji: '🏥', subcategories: ['Tablet', 'Scan', 'Appointment', 'Test', 'Health insurance'] },
  { name: 'Recharge', emoji: '🧾', subcategories: ['Mobile', 'Data', 'Wifi', 'DTH'] },
  { name: 'Shopping', emoji: '🛍️', subcategories: ['Clothes', 'Fashion', 'Jewellery', 'Electronics'] },
  { name: 'Travel', emoji: '✈️', subcategories: ['Flight', 'Hotel', 'Cab'] },
  { name: 'Personal Care', emoji: '💇', subcategories: ['Hair cut', 'Grooming'] },
  { name: 'Rent & Utilities', emoji: '🏠', subcategories: ['Rent', 'Electricity', 'Water', 'Gas'] },
  { name: 'Entertainment', emoji: '🎬', subcategories: ['Movie', 'Games', 'Subscriptions'] },
  { name: 'Investments & Mutual Funds', emoji: '🪙', subcategories: ['Mutual funds', 'Stocks', 'Paytm gold'] },
  { name: 'Fitness', emoji: '💪', subcategories: ['Gym', 'Badminton', 'Shuttle'] },
  { name: 'Credit Card Payment', emoji: '💳', subcategories: ['Bill payment'] },
  { name: 'Services', emoji: '🏦', subcategories: ['Financial Services'] },
  { name: 'Essentials', emoji: '📦', subcategories: ['Household'] },
  { name: 'CashBack', emoji: '↩️', subcategories: ['Cashback', 'Refund'] },
  { name: 'Others', emoji: '🔄', subcategories: ['Others'] },
];

export const SEED_PAYMENT_MODES: string[] = [
  'Axis',
  'Axis CC',
  'Flipkart Axis CC',
  'KVB',
  'Amazon Pay',
  'Sodexo',
  'Paytm',
  'Cash',
  'UPI',
  'Niyo SBM',
];

export const SEED_PEOPLE: string[] = ['Nikhil', 'Prathyusha', 'Family', 'House', 'Others'];
