import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A password field with a show/hide toggle. Accepts every prop a plain
// <input> does, so it drops in wherever type="password" was used.
//
// The toggle is a button, not a click on the icon, so it is keyboard
// reachable; type="button" keeps it from submitting the surrounding form.
// It never reveals anything by default, and reveal state is per field.
export default function PasswordInput({ className = 'input', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:text-gray-700"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
