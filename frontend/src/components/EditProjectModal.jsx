import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import api from '../utils/api';

// Name and description of a project. Only admins can change them, and the
// server checks the same rule.
export default function EditProjectModal({ project, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: project.name || '', description: project.description || '' });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => api.put(`/projects/${project.id}`, {
      name: form.name.trim(),
      description: form.description.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: err => setError(err.response?.data?.error || 'Could not save the project'),
  });

  const submit = e => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Project name is required');
    setError('');
    save.mutate();
  };

  return (
    <Modal title="Edit project" onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>
        )}
        <div>
          <label className="label">Project name *</label>
          <input className="input" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={save.isPending} className="btn-primary">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
