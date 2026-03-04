import { useApiQuery } from '@/hooks/useApi';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export default function SchemaSelector({ value, onChange }) {
  const { data } = useApiQuery('schemas', '/admin/db/schemas');

  return (
    <div className="p-3 border-b">
      <label className="text-xs text-muted-foreground mb-1.5 block">Schema</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select schema" />
        </SelectTrigger>
        <SelectContent>
          {data?.schemas?.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
