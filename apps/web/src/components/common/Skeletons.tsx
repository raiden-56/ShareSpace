import { Box, Card, CardContent, Skeleton, Stack } from '@mui/material';

/*
 * Loading skeletons sized to match the real content they stand in for.
 * They are shown only while data is genuinely loading from the server.
 */

const grid = (cols: Record<string, string>) => ({ display: 'grid', gap: 2, gridTemplateColumns: cols });

export function DashboardSummarySkeleton() {
  return (
    <Box aria-busy aria-label="Loading summary" sx={grid({ xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' })}>
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i}>
          <CardContent sx={{ p: 2.25 }}>
            <Skeleton width={90} height={16} />
            <Skeleton width="60%" height={34} sx={{ mt: 1 }} />
            <Skeleton width="45%" height={14} sx={{ mt: 0.5 }} />
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

export function GroupCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Box aria-busy aria-label="Loading groups" sx={grid({ xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' })}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <Skeleton variant="rectangular" height={6} animation={false} />
          <CardContent sx={{ p: 2.5 }}>
            <Stack direction="row" justifyContent="space-between">
              <Box sx={{ flex: 1 }}>
                <Skeleton width="55%" height={22} />
                <Skeleton width="30%" height={14} />
              </Box>
              <Skeleton variant="circular" width={28} height={28} />
            </Stack>
            <Skeleton width="40%" height={14} sx={{ mt: 2.5 }} />
            <Skeleton width="50%" height={26} />
            <Skeleton variant="rounded" height={8} sx={{ mt: 2 }} />
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

export function ExpenseListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack aria-busy aria-label="Loading expenses" divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={2} alignItems="center" sx={{ py: 1.5 }}>
          <Skeleton variant="rounded" width={40} height={40} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton width="45%" height={18} />
            <Skeleton width="30%" height={14} />
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Skeleton width={80} height={18} />
            <Skeleton width={60} height={14} sx={{ ml: 'auto' }} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function BalancePanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack aria-busy aria-label="Loading balances" spacing={1.5}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={1.5} alignItems="center">
          <Skeleton variant="circular" width={36} height={36} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="35%" height={18} />
            <Skeleton width="55%" height={14} />
          </Box>
          <Skeleton width={90} height={22} />
        </Stack>
      ))}
    </Stack>
  );
}

export function SettlementListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Stack aria-busy aria-label="Loading settlements" spacing={1.5}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2.5 }}>
          <Skeleton variant="circular" width={32} height={32} />
          <Skeleton width={18} height={18} />
          <Skeleton variant="circular" width={32} height={32} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="50%" height={18} />
          </Box>
          <Skeleton variant="rounded" width={88} height={32} />
        </Stack>
      ))}
    </Stack>
  );
}

export function ReportChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <Box aria-busy aria-label="Loading chart" sx={{ height, display: 'flex', alignItems: 'flex-end', gap: 1.25, px: 1, pb: 3 }}>
      {[45, 70, 35, 85, 55, 65, 30, 75, 50, 60].map((h, i) => (
        <Skeleton key={i} variant="rounded" sx={{ flex: 1, height: `${h}%` }} />
      ))}
    </Box>
  );
}

export function PlanCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Box aria-busy aria-label="Loading plans" sx={grid({ xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' })}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent sx={{ p: 2.5 }}>
            <Skeleton variant="rounded" width={70} height={22} />
            <Skeleton width="65%" height={22} sx={{ mt: 1.5 }} />
            <Skeleton width="45%" height={14} />
            <Skeleton width="35%" height={14} />
            <Skeleton variant="rounded" height={8} sx={{ mt: 2 }} />
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

export function ActivityFeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack aria-busy aria-label="Loading activity" spacing={2}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={1.5}>
          <Skeleton variant="circular" width={28} height={28} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="75%" height={16} />
            <Skeleton width="25%" height={12} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

export function MemberListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack aria-busy aria-label="Loading members" spacing={1.75}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" spacing={1.5} alignItems="center">
          <Skeleton variant="circular" width={40} height={40} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="30%" height={18} />
            <Skeleton width="45%" height={14} />
          </Box>
          <Skeleton variant="rounded" width={64} height={24} />
        </Stack>
      ))}
    </Stack>
  );
}
