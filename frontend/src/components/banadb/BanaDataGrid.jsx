import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { format } from 'date-fns';

function renderCell(value, dataType) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50 italic">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-success' : 'text-destructive'}>{value ? 'true' : 'false'}</span>;
  }
  if (dataType === 'uuid') {
    return <span className="font-mono text-xs" title={value}>{String(value).slice(0, 8)}...</span>;
  }
  if (['jsonb', 'json'].includes(dataType)) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return <span className="font-mono text-xs" title={str}>{str.slice(0, 60)}{str.length > 60 ? '...' : ''}</span>;
  }
  if (dataType?.includes('timestamp')) {
    try { return <span className="text-xs">{format(new Date(value), 'MMM d, yyyy HH:mm')}</span>; }
    catch { return String(value); }
  }
  const str = String(value);
  if (str.length > 100) return <span title={str}>{str.slice(0, 100)}...</span>;
  return str;
}

export default function BanaDataGrid({ projectId, table, onEditRow }) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });
  const [sorting, setSorting] = useState([]);

  const baseUrl = `/admin/bana/projects/${projectId}`;

  const { data, isLoading } = useQuery({
    queryKey: ['bana-table-data', projectId, table, pagination, sorting],
    queryFn: () =>
      api
        .get(`${baseUrl}/table/${table}`, {
          params: {
            schema: 'public',
            page: pagination.pageIndex + 1,
            pageSize: pagination.pageSize,
            sortBy: sorting[0]?.id || '',
            sortDir: sorting[0]?.desc ? 'desc' : 'asc',
          },
        })
        .then((r) => r.data),
    enabled: !!table,
    placeholderData: (prev) => prev,
  });

  const columns = useMemo(() => {
    if (!data?.columns) return [];
    return data.columns.map((col) => ({
      id: col.column_name,
      accessorKey: col.column_name,
      header: col.column_name,
      cell: ({ getValue }) => renderCell(getValue(), col.data_type),
    }));
  }, [data?.columns]);

  const pageCount = Math.ceil((data?.totalCount ?? 0) / pagination.pageSize);

  const tableInstance = useReactTable({
    data: data?.rows ?? [],
    columns,
    pageCount,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!table) {
    return <div className="p-6 text-sm text-muted-foreground">Select a table to browse</div>;
  }
  if (isLoading && !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted z-10">
            {tableInstance.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-left p-2 font-medium text-muted-foreground border-b cursor-pointer hover:bg-accent/50 select-none whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted()] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {tableInstance.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b hover:bg-accent/30 cursor-pointer"
                onDoubleClick={() => onEditRow?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2 max-w-[300px] truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between p-2 border-t bg-card text-xs">
        <span className="text-muted-foreground">
          {data?.totalCount ?? 0} rows | Page {pagination.pageIndex + 1} of {pageCount || 1}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => tableInstance.setPageIndex(0)} disabled={!tableInstance.getCanPreviousPage()}>
            <ChevronsLeft className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => tableInstance.previousPage()} disabled={!tableInstance.getCanPreviousPage()}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => tableInstance.nextPage()} disabled={!tableInstance.getCanNextPage()}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => tableInstance.setPageIndex(pageCount - 1)} disabled={!tableInstance.getCanNextPage()}>
            <ChevronsRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
