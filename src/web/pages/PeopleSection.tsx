import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import { Badge, Button } from "../components/ui";
import { formatDate } from "../lib/format";

export function PeopleSection({
  setNotice,
}: {
  setNotice: (notice: string) => void;
}) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const peopleQuery = useQuery({
    queryKey: ["users"],
    queryFn: ({ signal }) => api.get("listUsers", { signal }),
  });
  const [inviteLink, setInviteLink] = useState<string>();
  const createInvite = useMutation({
    mutationFn: () => api.post("createInvite", { body: {} }),
    onSuccess: (invite) => {
      setInviteLink(`${window.location.origin}/invite?token=${invite.token}`);
      setNotice("Invite link created. Copy it now; it is shown only once.");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete("revokeInvite", { params: { id } }),
    onSuccess: () => {
      setNotice("Invite revoked.");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const deleteUser = useMutation({
    mutationFn: (id: number) =>
      api.delete("deleteUser", { params: { id: String(id) } }),
    onSuccess: () => {
      setNotice("Account deleted.");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const updateRank = useMutation({
    mutationFn: (input: { id: number; rank: "admin" | "user" }) =>
      api.patch("updateUserRank", {
        params: { id: String(input.id) },
        body: { rank: input.rank },
      }),
    onSuccess: (user) => {
      setNotice(
        user.rank === "admin"
          ? `${user.username} is now an administrator.`
          : `${user.username} is now a user.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const currentId = sessionQuery.data?.user?.id;
  const openInvites =
    peopleQuery.data?.invites.filter((invite) => invite.status === "open") ??
    [];

  return (
    <section className="settings-section" id="people">
      <header>
        <span className="settings-section__icon">
          <Users size={20} />
        </span>
        <div>
          <h2>People</h2>
          <p>
            Invite friends as users. Promote someone when they should change
            settings too.
          </p>
        </div>
      </header>
      {peopleQuery.isError ? (
        <p className="field__error">{peopleQuery.error.message}</p>
      ) : null}
      <ul className="backup-list">
        {(peopleQuery.data?.users ?? []).map((user) => (
          <li key={user.id}>
            <span>
              <strong>{user.username}</strong>
              <small>{user.rank}</small>
            </span>
            {user.id === currentId ? (
              <Badge>{user.rank}</Badge>
            ) : (
              <div className="backup-list__actions">
                {user.rank === "user" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    busy={updateRank.isPending}
                    onClick={() =>
                      updateRank.mutate({ id: user.id, rank: "admin" })
                    }
                  >
                    Make admin
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    busy={updateRank.isPending}
                    onClick={() =>
                      updateRank.mutate({ id: user.id, rank: "user" })
                    }
                  >
                    Make user
                  </Button>
                )}
                {user.rank !== "admin" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    busy={deleteUser.isPending}
                    onClick={() => deleteUser.mutate(user.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="backup-actions">
        <Button
          type="button"
          variant="secondary"
          busy={createInvite.isPending}
          onClick={() => createInvite.mutate()}
        >
          <UserPlus size={16} /> Invite someone
        </Button>
        {inviteLink ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(inviteLink)}
          >
            <Copy size={16} /> Copy invite link
          </Button>
        ) : null}
      </div>
      {openInvites.length > 0 ? (
        <ul className="backup-list">
          {openInvites.map((invite) => (
            <li key={invite.id}>
              <span>
                <strong>Open invite</strong>
                <small>Expires {formatDate(invite.expiresAt)}</small>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                busy={revokeInvite.isPending}
                onClick={() => revokeInvite.mutate(invite.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
