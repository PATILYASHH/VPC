import { cn } from '@/lib/utils';

export default function LoadingSpinner({ className, fullScreen = false }) {
  if (fullScreen) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className={cn('h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary', className)} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8">
      <div className={cn('h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary', className)} />
    </div>
  );
}
