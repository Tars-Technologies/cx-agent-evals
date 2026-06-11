interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] max-w-md bg-bg-elevated border border-red-500/30 rounded-lg p-3 shadow-2xl animate-fade-in">
      <p className="text-xs text-red-400">{message}</p>
      <button
        onClick={onDismiss}
        className="text-[10px] text-text-dim mt-1 hover:text-text"
      >
        Dismiss
      </button>
    </div>
  );
}
