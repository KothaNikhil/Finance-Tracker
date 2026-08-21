/**
 * Attach existing (already-imported) transactions to a loan in bulk. Filter the candidate list by
 * amount range / text / direction (the same filter the Reports screen uses), pick the part they
 * represent (principal / repayment / interest), multi-select, then attach them all at once. Backs
 * the "these ₹50k–₹10L credits are repayments for this loan" case from a bank import.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { TxnFilter } from '@/core/analytics';
import type { Direction } from '@/core/domain/money';
import { formatINR } from '@/core/domain/money';
import { LOAN_PARTS, type LoanPart } from '@/core/lending/roles';
import { useUnattachedTxns } from '@/hooks/use-lending';
import { useTheme } from '@/hooks/use-theme';

export interface AttachExistingSheetProps {
  visible: boolean;
  onAttach: (txnIds: number[], part: LoanPart) => void;
  onClose: () => void;
}

/** A rupee-string input → paise, or undefined when empty / not a number. */
const textToPaise = (text: string): number | undefined => {
  const t = text.trim().replace(/[,\s₹]/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

const DIRECTIONS: { label: string; value: Direction | undefined }[] = [
  { label: 'Any', value: undefined },
  { label: 'Money out', value: 'out' },
  { label: 'Money in', value: 'in' },
];

export function AttachExistingSheet({ visible, onAttach, onClose }: AttachExistingSheetProps) {
  const theme = useTheme();
  const [part, setPart] = useState<LoanPart>('principal');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<Direction | undefined>(undefined);
  const [kbHeight, setKbHeight] = useState(0);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setPart('principal');
      setSelected(new Set());
      setMinText('');
      setMaxText('');
      setSearch('');
      setDirection(undefined);
    }
  }

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const filter: TxnFilter = {
    minPaise: textToPaise(minText),
    maxPaise: textToPaise(maxText),
    search: search.trim() || undefined,
    direction,
  };
  const candidates = useUnattachedTxns(filter);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const attach = () => {
    if (selected.size === 0) return;
    onAttach([...selected], part);
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.92} backdropPaddingBottom={kbHeight}>
      <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Attach existing transactions</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        {/* Filters */}
        <View style={styles.amountRow}>
          <TextInput value={minText} onChangeText={setMinText} placeholder="Min ₹" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[inputStyle, styles.flexInput]} />
          <TextInput value={maxText} onChangeText={setMaxText} placeholder="Max ₹" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[inputStyle, styles.flexInput]} />
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchant, note, UPI id…"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={[inputStyle, styles.searchInput]}
        />
        <View style={styles.chips}>
          {DIRECTIONS.map((d) => (
            <Chip key={d.label} label={d.label} selected={direction === d.value} onPress={() => setDirection(d.value)} />
          ))}
        </View>

        <ThemedText type="overline" themeColor="textSecondary" style={styles.attachAs}>
          ATTACH AS
        </ThemedText>
        <View style={styles.chips}>
          {LOAN_PARTS.map((p) => (
            <Chip key={p.part} label={p.label} selected={p.part === part} onPress={() => setPart(p.part)} />
          ))}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {candidates.length === 0 ? (
            <EmptyState title="No matches" message="No unattached transactions match these filters." />
          ) : (
            candidates.map((c) => {
              const isSel = selected.has(c.id);
              const out = c.direction === 'out';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSel }}
                  style={({ pressed }) => [styles.row, { backgroundColor: isSel ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
                >
                  <ThemedText type="smallBold" style={{ color: isSel ? theme.accent : theme.textSecondary, width: 20 }}>
                    {isSel ? '☑' : '☐'}
                  </ThemedText>
                  <View style={styles.rowLeft}>
                    <ThemedText type="default" numberOfLines={1}>
                      {c.counterpartyName ?? c.rawDetails ?? '—'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {c.isoDate}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: out ? theme.spend : theme.income }}>
                    {out ? '−' : '+'} {formatINR(c.paise)}
                  </ThemedText>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Button label={`Attach ${selected.size || ''}`.trim()} variant="primary" onPress={attach} disabled={selected.size === 0} style={styles.attachBtn} />
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  amountRow: { flexDirection: 'row', gap: Spacing.two },
  flexInput: { flex: 1 },
  searchInput: { marginTop: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.two },
  attachAs: { marginTop: Spacing.three },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.two },
  listContent: { gap: Spacing.one, paddingBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  rowLeft: { flex: 1, gap: Spacing.half },
  attachBtn: { marginTop: Spacing.two },
});
