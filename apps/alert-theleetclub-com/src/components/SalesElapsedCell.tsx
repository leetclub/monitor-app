import { SalesElapsedStack } from '@/components/SalesElapsedStack';
import type { SalesElapsedRow } from '@/lib/salesDisplay';

export function SalesElapsedCell({
  row,
  title,
}: {
  row: SalesElapsedRow | undefined;
  title?: string;
}) {
  return (
    <td title={title} className="alertSalesCell">
      <SalesElapsedStack row={row} title={title} />
    </td>
  );
}
