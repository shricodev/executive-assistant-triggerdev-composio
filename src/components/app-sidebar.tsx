"use client";

import { Activity, CircleCheckBig, LayoutDashboard, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/approvals", label: "Approvals", icon: CircleCheckBig },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function Nav({ pathname, badge }: { pathname: string | null; badge: ReactNode }) {
  return (
    <SidebarMenu>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active =
          pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton asChild isActive={active} tooltip={label}>
              <Link href={href} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden />
                <span>{label}</span>
              </Link>
            </SidebarMenuButton>
            {href === "/approvals" && badge}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function ActiveNav({ badge }: { badge: ReactNode }) {
  return <Nav pathname={usePathname()} badge={badge} />;
}

export function AppSidebar({ footer, badge }: { footer: ReactNode; badge: ReactNode }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[collapsible=icon]:hidden">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="grid leading-tight">
                  <span className="truncate font-semibold">Trigger.dev &lt;&gt; Composio</span>
                  <span className="text-xs text-muted-foreground">Executive assistant</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {/* The pathname is request data on dynamic routes, so the static
                shell renders the links without an active item first. */}
            <Suspense fallback={<Nav pathname={null} badge={null} />}>
              <ActiveNav badge={badge} />
            </Suspense>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
