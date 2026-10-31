import { Toaster as Sonner, toast } from "sonner";

/** Toasts (sonner) in the Crow Tech style. Render <Toaster /> once near the root. */
export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-md border border-ink/20 bg-surface-50 p-3 text-ui text-ink shadow-float",
          title: "font-azeret text-xs font-semibold",
          description: "text-ui text-primary-300",
          actionButton: "ml-auto rounded-sm bg-ink px-2 py-1 font-azeret text-2xs font-semibold text-surface-50",
          cancelButton: "rounded-sm px-2 py-1 font-azeret text-2xs text-primary-300",
          error: "border-danger-200/50 [&_[data-icon]]:text-danger-300",
          success: "[&_[data-icon]]:text-success-300",
          warning: "[&_[data-icon]]:text-warning-400",
        },
      }}
      {...props}
    />
  );
}

export { toast };
