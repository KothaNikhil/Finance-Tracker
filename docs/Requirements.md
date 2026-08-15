# Finance Tracker — Requirements Document

*Written in simple words. Last updated: 15 August 2026.*

---

## 1. What are we building?

A mobile app (for **Android** and **iPhone**) that helps me track my money.

Right now I track my expenses by hand in an Excel file. Every month I type in what I
spent, put it into a category, and add up the totals. This app should do that work for
me, but in a nicer and faster way.

The main idea:

1. I **import** my Paytm transaction file (an `.xlsx` I download from Paytm).
2. The app **reads** every transaction and **sorts it into the right category** by itself.
3. I see my money in a **clean, modern screen** with nice charts.
4. I can **fix or edit** anything the app got wrong.
5. I can **export** everything back to an Excel workbook — one file for the year, with
   one sheet per month — just like I do it by hand today.
6. All my data is **saved safely in my Google Drive**.

---

## 2. Who is this for and what do I want from it?

- **User:** Me (and later, possibly family). One person, one account to start.
- **Goal:** Stop doing manual Excel work every month.
- **Goal:** Always know where my money went, how much I invested, and what EMIs/loans
  are pending.
- **Goal:** Keep my old habit of a **yearly Excel workbook** so nothing feels lost.
- **Feel:** The app should look **modern, clean, and simple** — not cluttered.

---

## 3. Logging in

I should be able to sign in using **either**:

- **My Google account** (one tap), **or**
- **My email address + OTP** (a code sent to my email).

> **Decision (15 Aug 2026):** we use **email OTP**, not mobile/SMS OTP. Sending an SMS
> costs money; sending an email code is free, so email OTP is the choice for now. (Mobile
> SMS OTP can be added later if we ever want it.)

Rules:

- After I log in once, the app should **remember me** so I don't log in every time.
- I can **log out** whenever I want.
- My data is **private to my login** — no one else can see it.

---

## 4. Importing my Paytm statement (the core feature)

I download a file from Paytm called something like
`Paytm_UPI_Statement_01_May'26_-_31_May'26.xlsx`. The app must be able to open and read
this file.

### What the app must understand about the file

From looking at real Paytm files, here is how they are built. The app must handle all of
this correctly:

- The file has **two sheets**: a `Summary` sheet and a `Passbook Payment History` sheet.
  The real transactions are in the **`Passbook Payment History`** sheet. Skip the Summary
  sheet for importing (but it's useful to read the statement dates and my name from it).
- **Everything in the file is stored as plain text** — even dates and amounts. The app
  must read them as text and convert them properly.
- The transaction table has these columns:
  - **Date** — like `29/05/2026` (day/month/year).
  - **Time** — like `22:32:45`.
  - **Transaction Details** — a sentence like *"Paid to Sri Babu Raju Ram Fuel Station"*
    or *"Received from Vutukuri Prathyusha"*.
  - **UPI ID / A/c No.** — who I paid or who paid me (their UPI address).
  - **Your Account** — which of my accounts the money came from (e.g. *Axis Bank - 15*,
    *Karur Vysa Bank - 50*, *Gold Coins*, *UPI Linked Bank*).
  - **Amount** — like `-3,000.00` (money out), `+5,000.00` (money in), or with **no sign**
    for self-transfers (money moved between my own accounts).
  - **UPI Ref No.** — a unique number for the transaction.
  - **Order ID** — only present for some types (FASTag, Metro, credit-card bill, gold).
  - **Remarks** — my own short note.
  - **Tags** — my own category tag, like `#🥘 Food` or `#⛽️ Fuel`.
  - **Comment** — usually empty.

### Rules the app must follow when importing

- **Money out vs money in:** decide from the sign in the Amount column
  (`-` = spent, `+` = received). **No sign = a self-transfer** (money moved between my own
  accounts) — treat these specially, not as income or expense.
- **Don't double-count:** if I import two files that overlap (for example, a "May only"
  file and an "April–July" file that includes May again), the app must **detect and skip
  duplicates**. Use the *UPI Ref No.* to spot the same transaction; if that's missing, use
  the *Order ID*; if both are missing, use Date + Time + Amount + who it was with.
- **Use my Paytm tag as a starting hint** for the category (Paytm's `#🥘 Food` → my
  **Food & Dining** category), but the app should still let me change it.
- **Handle emojis** in tags correctly (don't crash or show broken symbols).
- Show me a **preview before saving** — "Found 82 transactions, 3 are duplicates, here's
  how I categorized them" — so I can confirm.

---

## 5. Automatic categorization

The app should look at each transaction and **guess the right category and sub-category**
by itself, so I don't have to sort them by hand.

### How it should guess

- Use the **Paytm tag** if present (e.g. `#🥘 Food` → *Food & Dining*).
- Use the **merchant / person name** (e.g. "Reliance Jio" → *Recharge*, "Zomato" →
  *Food & Dining*, a fuel station → *Bike / Fuel*).
- Learn from my past edits: if I always mark a certain shop as *Groceries*, remember that
  and do it automatically next time.

### How sure the app is (don't be too strict)

The app should **not be overly strict** about auto-categorizing — it's fine to make a best
guess. But I must be able to **see what the app decided** and easily fix it:

- Show which transactions were **auto-categorized** (vs ones I set myself).
- When the app is **not confident** (low match score), flag the transaction with a simple
  **"Needs review"** marker so I can quickly check just those.
- I can accept all guesses in one tap, or go through the flagged ones only.

### My categories (from my current Excel tracker)

The app should start with the categories I already use:

**Main categories:** Bike, Car, Commute, Food & Dining, Groceries, Investments & Mutual
Funds, Medicine & Health, Recharge, Shopping, Travel, Personal Care, Rent & Utilities,
Charges, CashBack, Entertainment, Trip, Money Lent, Stationary, Credit Card Payment,
Services, Fitness, Essentials, Exchange, Others.

### How categories and sub-categories work (nested)

**Every category has its own list of sub-categories.** The sub-categories belong *under*
a category — they are not one big shared list. For example:

- **Food & Dining** → Biriyani, Dosa, Restaurant, Dominos, Tea, Juice, Cake, …
- **Medicine & Health** → Tablet, Scan (or the exact scan name, e.g. "MRI scan"),
  Appointment, Test, Health insurance, Tonic, …
- **Bike** → Fuel, Cover, Water wash, …
- **Investments & Mutual Funds** → Mutual funds, Stocks, Paytm gold, …
- **Commute** → Metro, Bus, Train, Fast tag, …
- **Shopping** → Clothes, Fashion, Jewellery, Electronics, …

When I import a transaction, the app should **auto-pick both the category and the
sub-category**. After that, I get full flexibility:

- I can **change the category and/or the sub-category** on any transaction.
- I can **type a brand-new sub-category**, and it gets **added to the selected category's
  sub-category list** so it's suggested next time. (E.g. I type "MRI scan" under *Medicine
  & Health*, and from then on it's remembered under that category.)
- When I change the category, the sub-category **suggestions switch to that category's own
  list**.
- Sub-categories are **suggestions, never a locked list** — I can always type something new.
- I can **add, rename, or remove** both categories and their sub-categories.

Each transaction should also keep these extra details from my current tracker:

- **Payment Mode** — how I paid: Axis, Axis CC, Flipkart Axis CC, KVB, Amazon Pay,
  Sodexo, Paytm, Cash, UPI, Niyo SBM. **This list is configurable** — I can add, rename,
  or remove payment modes.
- **Type** — Expense, Investment, EMI, Credit Card Payment, Money Lent, or Received
  (income). This decides how it's added up in the dashboard.
- **For (who it's for)** — e.g. Nikhil, Prathyusha, Family, House. **This list is fully
  configurable by me** — I can add, rename, or remove people/groups at any time. Useful to
  see how much I spent on each person.
- **Tag / event** — like *Seemantham* or *Office* — to group spends for one occasion.
- **Description** and **Notes** — free text.

---

## 6. Viewing and editing transactions

- See all transactions in a **clean list**, newest first, with search and filters
  (by month, category, payment mode, person, or amount).
- **Tap any transaction to edit it** — change the category, sub-category, amount, note,
  who it's for, etc.
- **Add a transaction by hand** (for cash spends that aren't in Paytm).
- **Delete** a transaction.
- Mark a transaction as a **refund/cashback** (a negative amount that reduces spending).
- **Split a transaction** (optional/nice-to-have) — e.g. one shop bill that was part
  groceries and part household.

---

## 7. Dashboards (the charts and totals)

The app should show **neat, modern dashboards**, similar to the summary I keep in Excel
today but interactive.

**Monthly view:**

- Total spent, total invested, total money lent, EMI paid, number of transactions.
- A **pie chart**: spending by category.
- A **bar/line chart**: spending across the days of the month.
- Top merchants / biggest expenses.

**Yearly view:**

- A **line chart**: expenses vs investments across all 12 months.
- Category breakdown for the whole year (total, % of total, average per month).
- Payment-mode breakdown (how much went through each card/account).
- Totals row for the year.

**Trackers (special views):**

- **Investments:** how much I've put into mutual funds, stocks, gold, etc.
- **EMIs:** upcoming and paid EMIs (e.g. Car EMI ₹27,000/month).
- **Credit cards:** what I spent on each card and what I still owe.

Everything should update **instantly** when I add or edit a transaction.

---

## 8. Export to Excel (keep my old habit)

I want to **export my data to an Excel workbook**, the same way I do it manually now:

- **One workbook per year.**
- **One sheet per month** (January … December).
- Each monthly sheet lists all transactions with the same columns I use today (Date,
  Category, Sub-Category, Amount, Payment Mode, Type, Description, Notes, For).
- A **summary/dashboard sheet** with the yearly totals and charts.
- Keep my existing look where possible (title banners, KPI strip, category totals).

Rules:

- I can **export any year** with one tap.
- The exported file should be saved to **Google Drive** and also be **shareable**.

---

## 9. Where the data is stored (Google Drive)

> **Decision (15 Aug 2026):** for now, **Google Drive only** — no paid cloud database.
> A cloud database is wanted **later** (it makes multi-device and family sharing easier),
> but we are **not spending money on that yet**. So the app should be built so a cloud
> database can be added later without a rebuild.

- All my data (the database, the imported files, and the exported Excel files) is stored
  in **my own Google Drive**.
- The app should keep a **backup** in Drive so I never lose my data, even if I change
  phones.
- When I open the app on a new phone and log in, my data should **come back** from Drive.
- The app should work when I'm **offline** for basic viewing/adding, and **sync** to Drive
  when I'm back online.

---

## 10. Future features (not now, but plan for them)

The app should be built so these can be added later without a rebuild:

1. **Bank statements** — import my bank statement so the app can track my **income** too
   (salary, interest), not just spending.
2. **Other payment apps** — import transactions from **PhonePe, Google Pay**, and others,
   the same way I import Paytm.
3. **Credit card statements** — read my credit card statement to track card spends and
   bills automatically.
4. **Money Lent tracker (informal loans):** money I lend to people with no interest. Track
   who, how much, how much they've paid back (in parts), and whether it's *Active*,
   *Partially Paid*, or *Closed*. (From my current Excel.)
5. **Yearly Loan Tracker (loans with interest):** money I lend formally with an interest
   rate. Track borrower name, phone, amount, interest %, interest received, principal
   returned, balance left, next due date, and status. Keep a **payment history** for each
   loan. (From my current Excel.)

Because different sources have different file formats, the import feature should be built
in a **flexible way** so adding a new source (PhonePe, a bank, a card) is easy.

---

## 11. Extra things to capture — decided (15 Aug 2026)

I went through the "what else could we capture" ideas and picked which ones to include.

### Included (agreed to add)

- **Net worth summary:** one number showing investments + gold + money owed to me, minus
  what I owe — a quick "how am I doing".
- **EMI schedule:** a list of remaining EMIs with their end dates, so I know when each loan
  finishes (e.g. Car EMI).
- **Spend by person and by event:** using the "For" tag (Nikhil, Prathyusha, Family) and
  event tags (Seemantham, Office), show reports like *"Seemantham cost me ₹X total"* or
  *"I spent ₹Y on Prathyusha this year"*.
- **Merchant history:** tap a shop/person to see everything I ever paid them.
- **Per-account view:** since Paytm shows which account funded each payment (Axis, KVB,
  Gold Coins), show activity and balance per bank/card/wallet.
- **Cashback/refund totals:** add up money that came back to me (refunds and cashbacks),
  tracked separately from spending.
- **Search by note/remark:** find transactions by the note or remark text I typed.
- **Flexible export:** export a single category or a custom date range (not just full
  months).
- **App lock:** protect the app with fingerprint/face unlock, since it holds sensitive
  money data.
- **Family sharing (LATER):** let a spouse/family member share the same finance view. This
  is a *future* item — it will likely need the cloud database we deferred (see Section 9).

### Always included (core to the data)

- **Self-transfer handling:** clearly show money moved between my own accounts separately,
  so it never looks like income or spending. (Required because Paytm marks these with no
  +/- sign.)
- **Currency:** everything is in **Indian Rupees (₹)** — show the ₹ symbol everywhere.

### Comes with a future feature

- **Income & net savings:** arrives with the future **bank-statements** feature
  (Section 10) — once bank data is imported, show money in vs money out and monthly savings.

### Decided NOT to include (for now)

- ~~Monthly budgets per category with over-budget alerts~~
- ~~Recurring bill / subscription auto-detection + due reminders~~
- ~~Smart alerts (big-spend / EMI-due / credit-card-bill-due notifications)~~
- ~~Gold holdings tracker~~

(These can be reconsidered in a later version if I want them.)

---

## 12. How it should behave (simple quality rules)

- **Fast:** importing a file and opening dashboards should feel quick.
- **Safe:** my financial data must be protected (encrypted where possible, and an app lock).
- **Reliable:** never lose or double-count a transaction.
- **Easy:** anyone should be able to use it without a manual.
- **Modern look:** clean layout, nice colors, light and dark mode, smooth animations.
- **Works offline:** view and add transactions without internet; sync later.

---

## 13. Things to decide (open questions)

**Already decided (15 Aug 2026):**

- ✅ **Storage:** Google Drive only for now. Cloud database is wanted later but no money
  spent on it yet.
- ✅ **Login:** Google login **and** email OTP from the start (email OTP chosen over SMS
  OTP because email is free).
- ✅ **Technology:** use a **widely-supported, well-established cross-platform framework**
  (one codebase for Android + iPhone). It must also make a **future website easy** to build
  and maintain by me. So the choice should favor a stack whose skills/code carry over to
  the web (a React-based option like React Native + React web is a strong fit; final pick
  at planning time).
- ✅ **Drive location:** create a **visible folder named "Finance Tracker"** in my Google
  Drive home, so I can see and open it myself (not a hidden app folder).
- ✅ **Auto-categorization strictness:** don't be too strict. Make best-guess categories,
  but clearly **show what was auto-categorized**, and put a **"Needs review"** flag on
  low-confidence ones so I can check just those. (See Section 5.)

**Still to decide before building:**

- *(No open questions right now — will revisit at planning time.)*

---

## 14. Summary of what "done" looks like (first version)

The first working version should let me:

- [ ] Log in with Google, or with email + OTP.
- [ ] Import a Paytm `.xlsx` file, with duplicate detection and a preview.
- [ ] See every transaction, auto-categorized, and edit any of them.
- [ ] Add/delete transactions by hand.
- [ ] See monthly and yearly dashboards with charts.
- [ ] Export a yearly Excel workbook with one sheet per month.
- [ ] Store and back up everything in my Google Drive.
- [ ] Track investments, EMIs, and credit-card spends.

Future versions add bank statements (income), PhonePe/GPay import, credit-card statement
reading, and the two lending trackers (Money Lent + Yearly Loan Tracker).
