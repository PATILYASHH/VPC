import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

export default function BanaRowEditor({ open, onClose, projectId, table, row, columns, onSaved }) {
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  const isEdit = !!row;
  const baseUrl = `/admin/bana/projects/${projectId}`;

  useEffect(() => {
    if (!open) return;
    if (row) {
      setFormData({ ...row });
    } else {
      const initial = {};
      columns?.forEach((col) => {
        if (col.column_default?.includes('gen_random_uuid') || col.column_default?.includes('nextval')) return;
        if (col.column_default?.includes('NOW()') || col.column_default?.includes('now()')) return;
        initial[col.column_name] = '';
      });
      setFormData(initial);
    }
  }, [open, row, columns]);

  const handleSave = async () => {
    if (!table) return;
    setSaving(true);
    try {
      if (isEdit) {
        const pkCol = columns?.find((c) => c.column_default?.includes('gen_random_uuid')) || columns?.[0];
        const pkValue = row[pkCol.column_name];
        const { [pkCol.column_name]: _, ...data } = formData;
        await api.put(`${baseUrl}/table/${table}/row/${pkValue}?schema=public&primaryKey=${pkCol.column_name}`, data);
        toast.success('Row updated');
      } else {
        await api.post(`${baseUrl}/table/${table}/row?schema=public`, formData);
        toast.success('Row inserted');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const editableColumns = columns?.filter((col) => {
    if (!isEdit && (col.column_default?.includes('gen_random_uuid') || col.column_default?.includes('nextval'))) return false;
    if (!isEdit && (col.column_default?.includes('NOW()') || col.column_default?.includes('now()'))) return false;
    return true;
  }) || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Row' : 'Insert Row'} — {table}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editableColumns.map((col) => (
            <div key={col.column_name} className="space-y-1">
              <Label className="text-xs">
                {col.column_name}
                <span className="text-muted-foreground ml-1">({col.data_type})</span>
              </Label>
              {col.data_type === 'boolean' ? (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={formData[col.column_name] ?? ''}
                  onChange={(e) => setFormData({ ...formData, [col.column_name]: e.target.value === 'true' })}
                >
                  <option value="">NULL</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : ['text', 'jsonb', 'json'].includes(col.data_type) ? (
                <textarea
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono h-20 resize-y"
                  value={formData[col.column_name] ?? ''}
                  onChange={(e) => setFormData({ ...formData, [col.column_name]: e.target.value })}
                />
              ) : (
                <Input
                  value={formData[col.column_name] ?? ''}
                  onChange={(e) => setFormData({ ...formData, [col.column_name]: e.target.value })}
                  type={['integer', 'bigint', 'numeric', 'real', 'double precision', 'smallint'].includes(col.data_type) ? 'number' : 'text'}
                  className="text-sm"
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Insert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
