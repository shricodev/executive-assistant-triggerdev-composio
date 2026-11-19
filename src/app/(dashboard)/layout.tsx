import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarMenuBadge,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenu } from "@/components/user-menu";
import { countPending } from "@/lib/queries";
import { requireUser } from "@/lib/session";

async function CurrentUserMenu() {
  const user = await requireUser();
  return <UserMenu name={user.name} email={user.email} />;
}

async function PendingBadge() {
  const user = await requireUser();
  const pending = await countPending(user.id);
  if (pending === 0) return null;
  return <SidebarMenuBadge aria-label={`${pending} waiting for approval`}>{pending}</SidebarMenuBadge>;
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <AppSidebar
        badge={
          <Suspense fallback={null}>
            <PendingBadge />
          </Suspense>
        }
        footer={
          <Suspense fallback={<Skeleton className="h-12 w-full" />}>
            <CurrentUserMenu />
          </Suspense>
        }
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
