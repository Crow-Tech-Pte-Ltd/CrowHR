import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@crowhr/ui";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { relativeTime } from "../../../auth/format.ts";
import { useReauth } from "../../../auth/reauth.tsx";
import { can, useMe } from "../../../auth/session.ts";
import { type AssignedRole, type Member, type Page, ROLE_LABEL } from "../../../auth/types.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api.ts";
import { InviteDialog, LinkDialog, RolesDialog } from "../../../settings/members-dialogs.tsx";

export const Route = createFileRoute("/_app/settings/members")({
  component: MembersPage,
});

const STATUS_TONE = { active: "success", invited: "info", suspended: "warning", former: "neutral" } as const;
const STATUS_LABEL = { active: "Active", invited: "Invited", suspended: "Suspended", former: "Former" } as const;

function MembersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [link, setLink] = React.useState<{ title: string; body: string; url: string } | null>(null);
  const isOwner = me.roles.includes("owner");
  const canRead = can(me, "members:read");

  const params = new URLSearchParams({ page: String(page), pageSize: "25", sort: "displayName" });
  if (q.trim()) params.set("q", q.trim());
  if (status !== "all") params.set("status", status);
  const list = useQuery({
    queryKey: ["members", params.toString()],
    queryFn: () => apiGet<Page<Member>>(`/api/v1/members?${params}`),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["members"] });

  const act = async (label: string, run: () => Promise<unknown>, success: string) => {
    try {
      await withReauth(run);
      toast.success(success);
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") return;
      toast.error(err instanceof Error ? `${label}: ${err.message}` : `${label} failed.`);
    }
  };

  if (!canRead) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Settings", to: "/settings" }]} title="Members and roles" />
        <EmptyState
          icon={<Users />}
          title="You can't see members"
          description="Owners, HR admins and payroll admins manage who has access. Ask one of them if you need a change."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Members and roles"
        description="Who can sign in to your organisation and what they can do. Roles combine: one person can be both HR admin and payroll admin."
        actions={
          can(me, "members:create") ? (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite someone
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
          aria-label="Search members"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="former">Former</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border border-border">
        {list.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true" aria-label="Loading members">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorNote error={list.error} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Users />}
            title={q || status !== "all" ? "No members match" : "Only you so far"}
            description={
              q || status !== "all"
                ? "Try a different search or status."
                : "Invite your HR, payroll and team members so they can sign in."
            }
          />
        ) : (
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Two-step</TableHead>
                <TableHead className="hidden md:table-cell">Last active</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((m) => {
                const manageable = isOwner || m.roles.length === 0;
                const self = m.id === me.membershipId;
                return (
                  <TableRow key={m.id} data-testid={`member-${m.email}`}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium">
                          {m.displayName}
                          {m.preferredName && m.preferredName !== m.displayName ? (
                            <span className="ml-1 font-normal text-primary-200">· goes by {m.preferredName}</span>
                          ) : null}
                          {self ? <span className="ml-1 text-2xs text-primary-200">(you)</span> : null}
                        </span>
                        <span className="text-2xs text-primary-200">{m.email}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {m.roles.length ? (
                          m.roles.map((r) => (
                            <Badge key={r} variant={r === "owner" ? "ink" : "default"}>
                              {ROLE_LABEL[r]}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-2xs text-primary-200">Member</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col gap-0.5">
                        <StatusPill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusPill>
                        {m.invitation?.expired ? (
                          <span className="text-2xs text-warning-400">Invitation expired</span>
                        ) : null}
                        {m.lockedUntil ? (
                          <span className="text-2xs text-danger-300">Locked after failed sign-ins</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {m.mfaEnrolled ? (
                        <StatusPill tone="success">On</StatusPill>
                      ) : (
                        <span className="text-2xs text-primary-200">Not set up</span>
                      )}
                    </TableCell>
                    <TableCell className="num hidden md:table-cell">{relativeTime(m.lastActiveAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${m.displayName}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isOwner ? (
                            <DropdownMenuItem onSelect={() => setEditing(m)}>Change roles…</DropdownMenuItem>
                          ) : null}
                          {m.status === "invited" && manageable ? (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(
                                    "Resend",
                                    async () => {
                                      const r = await apiPost<{ inviteUrl: string | null }>(
                                        `/api/v1/members/${m.id}/invitation/resend`,
                                      );
                                      if (r.inviteUrl)
                                        setLink({
                                          title: "New invitation link",
                                          body: "The old link no longer works. Send this one; it lasts 7 days.",
                                          url: r.inviteUrl,
                                        });
                                    },
                                    "Invitation renewed.",
                                  )
                                }
                              >
                                Resend invitation
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void act(
                                    "Revoke",
                                    () => apiDelete(`/api/v1/members/${m.id}/invitation`),
                                    "Invitation withdrawn.",
                                  )
                                }
                              >
                                Withdraw invitation
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {(m.status === "active" || m.status === "former") &&
                          isOwner &&
                          m.roles.length === 0 &&
                          !me.mailerConfigured ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(
                                  "Reset link",
                                  async () => {
                                    const r = await apiPost<{ url: string }>(
                                      `/api/v1/members/${m.id}/password-reset-link`,
                                    );
                                    setLink({
                                      title: `Password reset link for ${m.displayName}`,
                                      body: "Works once, for 60 minutes. It's shown only now and the action is recorded in the audit log.",
                                      url: r.url,
                                    });
                                  },
                                  "Reset link created.",
                                )
                              }
                            >
                              Create password reset link
                            </DropdownMenuItem>
                          ) : null}
                          {isOwner && m.lockedUntil ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act("Unlock", () => apiPost(`/api/v1/members/${m.id}/unlock`), "Lockout cleared.")
                              }
                            >
                              Clear sign-in lockout
                            </DropdownMenuItem>
                          ) : null}
                          {isOwner && m.mfaEnrolled ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(
                                  "Reset 2-step",
                                  () => apiPost(`/api/v1/members/${m.id}/mfa/reset`),
                                  "Two-step verification reset.",
                                )
                              }
                            >
                              Reset two-step verification
                            </DropdownMenuItem>
                          ) : null}
                          {isOwner ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(
                                  "Sign out",
                                  () => apiPost(`/api/v1/members/${m.id}/sign-out-everywhere`),
                                  `${m.displayName} was signed out everywhere.`,
                                )
                              }
                            >
                              Sign out everywhere
                            </DropdownMenuItem>
                          ) : null}
                          {manageable && !self ? <DropdownMenuSeparator /> : null}
                          {manageable && !self && (m.status === "active" || m.status === "invited") ? (
                            <DropdownMenuItem
                              className="text-danger-300"
                              onSelect={() =>
                                void act(
                                  "Suspend",
                                  () => apiPost(`/api/v1/members/${m.id}/suspend`),
                                  `${m.displayName} is suspended and signed out.`,
                                )
                              }
                            >
                              Suspend
                            </DropdownMenuItem>
                          ) : null}
                          {manageable && m.status === "suspended" ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(
                                  "Reactivate",
                                  () => apiPost(`/api/v1/members/${m.id}/reactivate`),
                                  "Reactivated.",
                                )
                              }
                            >
                              Reactivate
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {list.data && list.data.total > list.data.pageSize ? (
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
            className="border-t border-border px-3"
          />
        ) : null}
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} canGrantRoles={isOwner} onInvited={refresh} />
      <RolesDialog
        member={editing}
        onOpenChange={(o) => (o ? null : setEditing(null))}
        onSave={async (roles: AssignedRole[]) => {
          if (!editing) return;
          await withReauth(() => apiPut(`/api/v1/members/${editing.id}/roles`, { roles }));
          toast.success("Roles saved.");
          refresh();
        }}
      />
      <LinkDialog link={link} onOpenChange={(o) => (o ? null : setLink(null))} />
    </>
  );
}
