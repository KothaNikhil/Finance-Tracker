import { Card } from '@/components/card';
import { InfoDisclosure } from '@/components/info-disclosure';
import { Skeleton } from '@/components/skeleton';
import { StatStrip, StatTile } from '@/components/stat-tile';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

export const ACTIVITY_TOTALS_NOTE =
  'Self-transfers, lending principal, and linked card payments are excluded. Refunds offset spending.';

export interface ActivitySummaryProps {
  loading: boolean;
  spentPaise: number;
  receivedPaise: number;
}

/**
 * Spent and received for the active Activity filter. The matching transaction count lives in the
 * list heading right below, so it is deliberately absent here.
 */
export function ActivitySummary({ loading, spentPaise, receivedPaise }: ActivitySummaryProps) {
  const theme = useTheme();

  return (
    <Card padding="small">
      <InfoDisclosure label="How Activity totals are counted" text={ACTIVITY_TOTALS_NOTE}>
        {loading ? (
          <Skeleton width="72%" height={30} />
        ) : (
          <StatStrip>
            <StatTile
              variant="column"
              label="Spent"
              value={formatINR(spentPaise)}
              color={theme.spend}
            />
            <StatTile
              variant="column"
              label="Received"
              value={formatINR(receivedPaise)}
              color={theme.income}
            />
          </StatStrip>
        )}
      </InfoDisclosure>
    </Card>
  );
}
