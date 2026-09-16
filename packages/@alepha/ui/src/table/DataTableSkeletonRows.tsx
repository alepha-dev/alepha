import { Skeleton } from "../core/Skeleton.tsx";
import { TableCell, TableRow } from "../core/Table.tsx";

export interface DataTableSkeletonRowsProps {
  rows: number;
  cols: number;
}

/**
 * Placeholder rows, shown while the first page loads.
 */
export const DataTableSkeletonRows = (props: DataTableSkeletonRowsProps) => {
  return (
    <>
      {Array.from({ length: props.rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: props.cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
};
