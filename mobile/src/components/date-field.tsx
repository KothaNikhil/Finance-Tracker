/**
 * The app's single date control. Dates are entered by picking a day, never by typing, and the value
 * stays the app-wide ISO `yyyy-MM-dd` string so nothing downstream has to reparse.
 *
 * The calendar expands inline rather than in its own modal: most callers already live inside a
 * bottom sheet, and the app shows one sheet at a time. It is also built entirely from our own
 * primitives, so it adds no native surface and behaves the same on iOS, Android and web.
 */

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { daysInMonth } from '@/core/domain/date';
import { useTheme } from '@/hooks/use-theme';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** A year page fits a 3×4 grid, so any year within six of the cursor is one tap away. */
const YEARS_PER_PAGE = 12;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface YearMonth {
  year: number;
  month: number;
}

export interface DateFieldProps {
  label: string;
  /** ISO `yyyy-MM-dd`, or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  clearable?: boolean;
  testID?: string;
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  placeholder = 'Choose a date',
  error,
  disabled = false,
  clearable = false,
  testID,
}: DateFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<YearMonth>(() => monthOf(value) ?? monthOf(todayIso())!);
  const [pickingYear, setPickingYear] = useState(false);
  const [yearPage, setYearPage] = useState(0);

  const minIso = minimumDate ? isoOf(minimumDate) : null;
  const maxIso = maximumDate ? isoOf(maximumDate) : null;
  const selected = parseIso(value);

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      setCursor(monthOf(value) ?? monthOf(todayIso())!);
      setPickingYear(false);
      setYearPage(0);
    }
    setOpen((wasOpen) => !wasOpen);
  };

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
    setPickingYear(false);
  };

  const shiftMonth = (delta: -1 | 1) => {
    setCursor(({ year, month }) => {
      const next = month + delta;
      if (next < 1) return { year: year - 1, month: 12 };
      if (next > 12) return { year: year + 1, month: 1 };
      return { year, month: next };
    });
  };

  const inRange = (iso: string) => (minIso == null || iso >= minIso) && (maxIso == null || iso <= maxIso);
  const today = todayIso();

  const yearBase = cursor.year - (((cursor.year % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE) + yearPage * YEARS_PER_PAGE;
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearBase + index);
  const yearInRange = (year: number) =>
    (minIso == null || toIso(year, 12, 31) >= minIso) && (maxIso == null || toIso(year, 1, 1) <= maxIso);

  const previousDisabled = pickingYear
    ? !years.some((year) => yearInRange(year - YEARS_PER_PAGE))
    : !inRangeMonth(shift(cursor, -1), minIso, maxIso);
  const nextDisabled = pickingYear
    ? !years.some((year) => yearInRange(year + YEARS_PER_PAGE))
    : !inRangeMonth(shift(cursor, 1), minIso, maxIso);

  const step = (delta: -1 | 1) => {
    if (pickingYear) setYearPage((page) => page + delta);
    else shiftMonth(delta);
  };

  const chooseYear = (year: number) => {
    const stillValid = inRangeMonth({ year, month: cursor.month }, minIso, maxIso);
    const month = stillValid
      ? cursor.month
      : (MONTH_NUMBERS.find((candidate) => inRangeMonth({ year, month: candidate }, minIso, maxIso)) ?? cursor.month);
    setCursor({ year, month });
    setPickingYear(false);
    setYearPage(0);
  };

  const borderColor = error ? theme.spend : open ? theme.focus : theme.borderStrong;

  return (
    <View style={styles.container} testID={testID}>
      <ThemedText type={TextRole.fieldLabel} style={styles.label}>
        {label}
      </ThemedText>

      <Pressable
        onPress={toggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatLong(value) : 'Not set' }}
        accessibilityHint="Opens a calendar to choose a date"
        accessibilityState={{ expanded: open, disabled }}
        testID={testID ? `${testID}-trigger` : undefined}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor,
            opacity: disabled ? 0.55 : pressed ? Opacity.pressed : 1,
          },
        ]}
      >
        <SymbolView
          name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
          size={15}
          tintColor={theme.textSecondary}
        />
        <ThemedText
          type={TextRole.rowTitle}
          numberOfLines={1}
          style={[styles.value, value ? null : { color: theme.textSecondary }]}
        >
          {value ? formatShort(value) : placeholder}
        </ThemedText>
        {clearable && value && !disabled ? (
          <Pressable
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            testID={testID ? `${testID}-clear` : undefined}
            style={({ pressed }) => [styles.clear, { opacity: pressed ? Opacity.pressed : 1 }]}
          >
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={15}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        ) : null}
        <SymbolView
          name={{
            ios: open ? 'chevron.up' : 'chevron.down',
            android: open ? 'expand_less' : 'expand_more',
            web: open ? 'expand_less' : 'expand_more',
          }}
          size={15}
          tintColor={theme.textSecondary}
        />
      </Pressable>

      {open ? (
        <View style={[styles.calendar, { borderColor: theme.border }]}>
          <View style={styles.monthBar}>
            <Pressable
              onPress={() => step(-1)}
              disabled={previousDisabled}
              accessibilityRole="button"
              accessibilityLabel={pickingYear ? `Previous ${YEARS_PER_PAGE} years` : 'Previous month'}
              accessibilityState={{ disabled: previousDisabled }}
              style={({ pressed }) => [
                styles.monthNav,
                { opacity: previousDisabled ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
              ]}
            >
              <SymbolView
                name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                size={16}
                tintColor={theme.text}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                setYearPage(0);
                setPickingYear((choosing) => !choosing);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                pickingYear
                  ? `${years[0]} to ${years[years.length - 1]}`
                  : `${MONTHS_LONG[cursor.month - 1]} ${cursor.year}`
              }
              accessibilityHint={pickingYear ? 'Returns to choosing a day' : 'Switches to choosing a year'}
              accessibilityState={{ expanded: pickingYear }}
              style={({ pressed }) => [styles.monthTitleTap, { opacity: pressed ? Opacity.pressed : 1 }]}
            >
              <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
                {pickingYear
                  ? `${years[0]} – ${years[years.length - 1]}`
                  : `${MONTHS_LONG[cursor.month - 1]} ${cursor.year}`}
              </ThemedText>
              <SymbolView
                name={{
                  ios: pickingYear ? 'chevron.up' : 'chevron.down',
                  android: pickingYear ? 'expand_less' : 'expand_more',
                  web: pickingYear ? 'expand_less' : 'expand_more',
                }}
                size={14}
                tintColor={theme.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => step(1)}
              disabled={nextDisabled}
              accessibilityRole="button"
              accessibilityLabel={pickingYear ? `Next ${YEARS_PER_PAGE} years` : 'Next month'}
              accessibilityState={{ disabled: nextDisabled }}
              style={({ pressed }) => [
                styles.monthNav,
                { opacity: nextDisabled ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
              ]}
            >
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.text}
              />
            </Pressable>
          </View>

          {pickingYear ? (
            <View style={styles.yearGrid}>
              {years.map((year) => {
                const yearDisabled = !yearInRange(year);
                const isCurrentYear = selected?.year === year;
                return (
                  <Pressable
                    key={year}
                    onPress={() => chooseYear(year)}
                    disabled={yearDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={String(year)}
                    accessibilityState={{ selected: isCurrentYear, disabled: yearDisabled }}
                    style={({ pressed }) => [
                      styles.year,
                      isCurrentYear ? { backgroundColor: theme.accent } : null,
                      { opacity: yearDisabled ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
                    ]}
                  >
                    <ThemedText
                      type={TextRole.detailValue}
                      style={isCurrentYear ? { color: theme.onAccent } : undefined}
                    >
                      {year}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {pickingYear ? null : (
            <View style={styles.week} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {WEEKDAYS.map((day, index) => (
                <ThemedText
                  key={`${day}-${index}`}
                  type={TextRole.badge}
                  themeColor="textSecondary"
                  style={styles.weekday}
                >
                  {day}
                </ThemedText>
              ))}
            </View>
          )}

          {pickingYear ? null : weeksOf(cursor).map((week, weekIndex) => (
            <View key={`week-${weekIndex}`} style={styles.week}>
              {week.map((day, dayIndex) => {
                if (day == null) return <View key={`pad-${dayIndex}`} style={styles.day} />;
                const iso = toIso(cursor.year, cursor.month, day);
                const isSelected =
                  selected != null &&
                  selected.year === cursor.year &&
                  selected.month === cursor.month &&
                  selected.day === day;
                const dayDisabled = !inRange(iso);
                return (
                  <Pressable
                    key={iso}
                    onPress={() => pick(iso)}
                    disabled={dayDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={`${WEEKDAY_NAMES[dayIndex]} ${day} ${MONTHS_LONG[cursor.month - 1]} ${cursor.year}`}
                    accessibilityState={{ selected: isSelected, disabled: dayDisabled }}
                    style={({ pressed }) => [
                      styles.day,
                      isSelected ? { backgroundColor: theme.accent } : null,
                      !isSelected && iso === today ? { borderColor: theme.accent, borderWidth: 1 } : null,
                      { opacity: dayDisabled ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
                    ]}
                  >
                    <ThemedText
                      type={TextRole.detailValue}
                      style={
                        isSelected
                          ? { color: theme.onAccent }
                          : iso === today
                            ? { color: theme.accent }
                            : undefined
                      }
                    >
                      {day}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={() => pick(today)}
              disabled={!inRange(today)}
              accessibilityRole="button"
              accessibilityLabel="Select today"
              accessibilityState={{ disabled: !inRange(today) }}
              style={({ pressed }) => [
                styles.footerAction,
                { opacity: !inRange(today) ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
              ]}
            >
              <ThemedText type={TextRole.sheetHeader} style={{ color: theme.accent }}>
                Today
              </ThemedText>
            </Pressable>
            {clearable && value ? (
              <Pressable
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${label}`}
                style={({ pressed }) => [
                  styles.footerAction,
                  { opacity: pressed ? Opacity.pressed : 1 },
                ]}
              >
                <ThemedText type={TextRole.sheetHeader} style={{ color: theme.spend }}>
                  Clear
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {error ? (
        <ThemedText type={TextRole.badge} style={{ color: theme.spend }} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Today as an ISO `yyyy-MM-dd` string in the device's own calendar day. */
export function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function isoOf(date: Date): string {
  return toIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIso(value: string | null): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = ISO.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function monthOf(value: string | null): YearMonth | null {
  const parsed = parseIso(value);
  return parsed ? { year: parsed.year, month: parsed.month } : null;
}

function shift({ year, month }: YearMonth, delta: number): YearMonth {
  const next = month + delta;
  if (next < 1) return { year: year - 1, month: 12 };
  if (next > 12) return { year: year + 1, month: 1 };
  return { year, month: next };
}

/** Whether any day of a month falls inside the allowed range. */
function inRangeMonth({ year, month }: YearMonth, minIso: string | null, maxIso: string | null): boolean {
  const first = toIso(year, month, 1);
  const last = toIso(year, month, daysInMonth(year, month));
  return (minIso == null || last >= minIso) && (maxIso == null || first <= maxIso);
}

function weeksOf({ year, month }: YearMonth): (number | null)[][] {
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function formatShort(value: string): string {
  const parsed = parseIso(value);
  if (!parsed) return value;
  return `${parsed.day} ${MONTHS_SHORT[parsed.month - 1]} ${parsed.year}`;
}

function formatLong(value: string): string {
  const parsed = parseIso(value);
  if (!parsed) return value;
  return `${parsed.day} ${MONTHS_LONG[parsed.month - 1]} ${parsed.year}`;
}

const styles = StyleSheet.create({
  container: { gap: Spacing.half },
  label: { marginLeft: Spacing.half },
  field: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  value: { flex: 1, minWidth: 0 },
  clear: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  calendar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.one,
    paddingBottom: Spacing.one,
  },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  monthNav: {
    width: TouchTarget,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitleTap: {
    flex: 1,
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  year: {
    width: '33.333%',
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: Spacing.half },
  day: {
    flex: 1,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.one,
  },
  footerAction: {
    minHeight: TouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
});
