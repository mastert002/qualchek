import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, ListChecks, PlayCircle, Trash2 } from 'lucide-react';
import api from '../utils/api';
import Modal from '../components/Modal';
import { fmtDate } from '../utils/helpers';
import { useRole } from '../hooks/useRole';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';

function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate();
  return (
    <div
      className="card p-5 cursor-pointer hover:shadow-md transition-shadow group"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
          <FolderKanban className="w-5 h-5 text-brand-600" />
        </div>
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(project.id); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <h3 className="font-semibold text-gray-900 mb-1">{project.name}</h3>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{project.description || 'No description'}</p>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" />
          {project.test_case_count || 0} cases
        </span>
        <span className="flex items-center gap-1">
          <PlayCircle className="w-3.5 h-3.5" />
          {project.test_run_count || 0} runs
        </span>
        <span className="ml-auto">{fmtDate(project.created_at)}</span>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const qc = useQueryClient();
  const { canManage } = useRole();
  const toast = useToast();
  const { confirm } = useConfirm();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: data => api.post('/projects', data),
    onSuccess: () => {
      qc.invalidateQueries(['projects']);
      setShowCreate(false);
      setForm({ name: '', description: '' });
      toast.success('Project created successfully', 'Project Created');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create project'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries(['projects']); toast.success('Project deleted'); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to delete project'),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-500 mt-1">Manage your test projects</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> New Project
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="w-10 h-10 bg-gray-200 rounded-xl mb-3" />
              <div className="h-4 bg-gray-200 rounded mb-2" />
              <div className="h-3 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <FolderKanban className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-4">Create your first project to start managing test cases.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p}
              onDelete={canManage ? async id => {
                const ok = await confirm({ title: 'Delete Project', message: 'This will permanently delete all test cases and runs in this project. Are you sure?', confirmLabel: 'Delete Project', variant: 'danger' });
                if (ok) deleteMutation.mutate(id);
              } : null}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Project" onClose={() => setShowCreate(false)}>
          <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4">
            <div>
              <label className="label">Project Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={3} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Creating...' : 'Create Project'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
