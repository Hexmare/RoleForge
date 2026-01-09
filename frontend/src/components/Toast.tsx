import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

type ToastType = 'info' | 'success' | 'error';
interface ToastItem { id: number; type: ToastType; message: string }

const ToastContext = createContext<{ push: (type: ToastType, message: string) => void } | null>(null);

export const ToastProvider: React.FC<React.PropsWithChildren<unknown>> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(t => [...t, { id, type, message }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t => {
      return window.setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id));
      }, 3500);
    });
    return () => timers.forEach(t => clearTimeout(t));
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', right: 12, top: 12, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ minWidth: 200, padding: '8px 12px', borderRadius: 6, color: '#fff', background: t.type === 'error' ? '#c62828' : t.type === 'success' ? '#2e7d32' : '#455a64', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return {
    info: (m: string) => ctx.push('info', m),
    success: (m: string) => ctx.push('success', m),
    error: (m: string) => ctx.push('error', m),
  };
};

export default ToastProvider;
