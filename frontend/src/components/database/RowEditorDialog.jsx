import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

function getInputType(dataType) {
  if (['integer', 'bigint', 'smallint'].includes(dataType)) return 'number';
  if (['numeric', 'real', 'double precision'].includes(dataType)) return 'number';
  if (dataType?.includes('timestamp')) return 'datetime-local';
  if (dataType === 'date') return 'date';
  return 'text';
}

export default function RowEditorDialog({ open, onClose, schema, table, row, columns, onSaved }) {
  const isNew = !row;
  const [formData, setFormData] = useState({});
  const [nullFields, setNullFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (row) {
        const data = { ...row };
        const nulls = {};
        for (const col of columns || []) {
          if (data[col.column_name] === null) nulls[col.column_name] = true;
        }
        setFormData(data);
        setNullFields(nulls);
      } else {
        setFormData({});
        setNullFields({});
      }
    }
  }, [open, row, columns]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {};
      for (const col of columns) {
        const name = col.column_name;
        if (col.column_default?.includes('gen_random_uuid') && isNew) continue;
        if (col.column_default?.includes('now()') && isNew) continue;
        if (nullFields[name]) {
          data[name] = null;
        } else if (formData[name] !== undefined && formData[name] !== '') {
          data[name] = formData[name];
        }
      }

      if (isNew) {
        await api.post(`/admin/db/table/${table}/row?schema=${schema}`, { data });
        toast.success('Row inserted');
      } else {
        const pkCol = columns.find((c) => c.column_default?.includes('gen_random_uuid')) || columns[0];
        const pkName = pkCol.column_name;
        const pkValue = row[pkName];
        await api.put(`/admin/db/table/${table}/row/${pkValue}?schema=${schema}`, { data, primaryKey: pkName });
        toast.success('Row updated');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Insert Row' : 'Edit Row'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {columns?.map((col) => {
            const name = col.column_name;
            const isAutoGen = col.column_default?.includes('gen_random_uuid') || col.column_default?.includes('now()');
            const isLargeText = col.data_type === 'text' || (['jsonb', 'json'].includes(col.data_type));

            return (
              <div key={name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">{name}</Label>
                  <span className="text-[10px] text-muted-foreground">{col.data_type}</span>
                  {col.is_nullable === 'YES' && (
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1 ml-auto">
                      <input
                        type="checkbox"
                        checked={!!nullFields[name]}
                        onChange={(e) => setNullFields({ ...nullFields, [name]: e.target.checked })}
                        className="w-3 h-3"
                      />
                      NULL
                    </label>
                  )}
                </div>
                {isLargeText ? (
                  <textarea
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono min-h-[80px]"
                    value={nullFields[name] ? '' : (formData[name] ?? '')}
                    onChange={(e) => setFormData({ ...formData, [name]: e.target.value })}
                    disabled={nullFields[name] || (isAutoGen && !isNew ? false : false)}
                    placeholder={isAutoGen ? '(auto-generated)' : ''}
                  />
                ) : (
                  <Input
                    type={getInputType(col.data_type)}
                    value={nullFields[name] ? '' : (formData[name] ?? '')}
                    onChange={(e) => setFormData({ ...formData, [name]: e.target.value })}
                    disabled={nullFields[name]}
                    placeholder={isAutoGen ? '(auto-generated)' : ''}
                    step={col.data_type === 'integer' ? '1' : 'any'}
                    className="text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isNew ? 'Insert' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
