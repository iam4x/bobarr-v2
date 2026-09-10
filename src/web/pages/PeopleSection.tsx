import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import { Badge, Button } from "../components/ui";
import { useUi } from "../i18n/ui";
import { formatDate } from "../lib/format";

export function PeopleSection({
  setNotice,
}: {
  setNotice: (notice: string) => void;
}) {
  const { messages, locale } = useUi();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => api.get("currentSession", { signal }),
  });
  const peopleQuery = useQuery({
    queryKey: ["users"],
    queryFn: ({ signal }) => api.get("listUsers", { signal }),
  });
  const [createdInvite, setCreatedInvite] = useState<{
    id: string;
    url: string;
    expiresAt: string;
  }>();
  const createInvite = useMutation({
    mutationFn: () => api.post("createInvite", { body: {} }),
    onSuccess: (invite) => {
      setCreatedInvite({
        id: invite.id,
        url: `${window.location.origin}/invite?token=${invite.token}`,
        expiresAt: invite.expiresAt,
      });
      setNotice(messages.people.inviteCreated);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete("revokeInvite", { params: { id } }),
    onSuccess: (_, id) => {
      setNotice(messages.people.inviteRevoked);
      setCreatedInvite((current) => (current?.id === id ? undefined : current));
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const deleteUser = useMutation({
    mutationFn: (id: number) =>
      api.delete("deleteUser", { params: { id: String(id) } }),
    onSuccess: () => {
      setNotice(messages.people.accountDeleted);
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
          ? messages.people.nowAdmin({ username: user.username })
          : messages.people.nowUser({ username: user.username }),
      );
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const currentId = sessionQuery.data?.user?.id;
  const listedOpenInvites =
    peopleQuery.data?.invites.filter((invite) => invite.status === "open") ??
    [];
  const openInvites =
    createdInvite &&
    !listedOpenInvites.some((invite) => invite.id === createdInvite.id)
      ? [
          { id: createdInvite.id, expiresAt: createdInvite.expiresAt },
          ...listedOpenInvites,
        ]
      : listedOpenInvites;

  return (
    <section className="settings-section" id="people">
      <header>
        <span className="settings-section__icon">
          <Users size={20} />
        </span>
        <div>
          <h2>{messages.people.title}</h2>
          <p>{messages.people.description}</p>
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
              <small>
                {user.rank === "admin"
                  ? messages.people.rankAdmin
                  : messages.people.rankUser}
              </small>
            </span>
            {user.id === currentId ? (
              <Badge>
                {user.rank === "admin"
                  ? messages.people.rankAdmin
                  : messages.people.rankUser}
              </Badge>
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
                    {messages.people.makeAdmin}
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
                    {messages.people.makeUser}
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
                    {messages.common.delete}
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
          <UserPlus size={16} /> {messages.people.inviteSomeone}
        </Button>
      </div>
      {openInvites.length > 0 ? (
        <ul className="backup-list">
          {openInvites.map((invite) => (
            <li key={invite.id}>
              <span>
                <strong>{messages.people.openInvite}</strong>
                <small>
                  {messages.people.expires({
                    date:
                      formatDate(invite.expiresAt, locale) ??
                      messages.dates.unknown,
                  })}
                </small>
              </span>
              <div className="backup-list__actions">
                {createdInvite?.id === invite.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void navigator.clipboard.writeText(createdInvite.url)
                    }
                  >
                    <Copy size={16} /> {messages.people.copyInvite}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  busy={revokeInvite.isPending}
                  onClick={() => revokeInvite.mutate(invite.id)}
                >
                  {messages.common.revoke}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
