import { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger' }) => {
    return new Promise((resolve) => {
      setDialog({ title, message, confirmLabel, cancelLabel, variant, resolve });
    });
  }, []);

  const handleClose = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  const VARIANT_STYLES = {
    // The deepest brand red: this is the last click before something is gone,
    // so it must read as heavier than the ordinary primary action.
    danger:  { btn: 'bg-brand-800 hover:bg-brand-900 text-white focus:ring-brand-700', icon: <Trash2 className="w-5 h-5 text-brand-800" />, iconBg: 'bg-brand-100' },
    warning: { btn: 'bg-yellow-500 hover:bg-yellow-600 text-white focus:ring-yellow-400', icon: <AlertTriangle className="w-5 h-5 text-yellow-600" />, iconBg: 'bg-yellow-100' },
    info:    { btn: 'bg-brand-600 hover:bg-brand-700 text-white focus:ring-brand-500', icon: <AlertTriangle className="w-5 h-5 text-brand-600" />, iconBg: 'bg-brand-100' },
  };

  const v = dialog ? (VARIANT_STYLES[dialog.variant] || VARIANT_STYLES.danger) : VARIANT_STYLES.danger;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {dialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => handleClose(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start gap-4 mb-5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${v.iconBg}`}>
                {v.icon}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <h3 className="text-base font-semibold text-gray-900">{dialog.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{dialog.message}</p>
              </div>
              <button onClick={() => handleClose(false)}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button onClick={() => handleClose(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300
                  rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors">
                {dialog.cancelLabel}
              </button>
              <button onClick={() => handleClose(true)}
                className={`px-4 py-2 text-sm font-medium rounded-lg focus:outline-none focus:ring-2
                  focus:ring-offset-2 transition-colors ${v.btn}`}>
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
