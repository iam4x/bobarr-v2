import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import { Badge, Button, Dialog, Field } from "../components/ui";
import { useUi } from "../i18n/ui";
import { formatDate } from "../lib/format";

const INVITE_LINK_INPUT_ID = "created-invite-link";

export function PeopleSection({
  onNotice,
  onError,
}: {
  onNotice: (notice: string) => void;
  onError: (error: Error) => void;
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
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    username: string;
  }>();
  const createInvite = useMutation({
    mutationFn: () => api.post("createInvite", { body: {} }),
    onSuccess: (invite) => {
      setCreatedInvite({
        id: invite.id,
        url: `${window.location.origin}/invite?token=${invite.token}`,
        expiresAt: invite.expiresAt,
      });
      onNotice(messages.people.inviteCreated);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError,
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete("revokeInvite", { params: { id } }),
    onSuccess: (_, id) => {
      onNotice(messages.people.inviteRevoked);
      setCreatedInvite((current) => (current?.id === id ? undefined : current));
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError,
  });
  const deleteUser = useMutation({
    mutationFn: (id: number) =>
      api.delete("deleteUser", { params: { id: String(id) } }),
    onSuccess: () => {
      setPendingDelete(undefined);
      onNotice(messages.people.accountDeleted);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError,
  });
  const updateRank = useMutation({
    mutationFn: (input: { id: number; rank: "admin" | "user" }) =>
      api.patch("updateUserRank", {
        params: { id: String(input.id) },
        body: { rank: input.rank },
      }),
    onSuccess: (user) => {
      onNotice(
        user.rank === "admin"
          ? messages.people.nowAdmin({ username: user.username })
          : messages.people.nowUser({ username: user.username }),
      );
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError,
  });
  const copyInvite = async (url: string) => {
    try {
      // navigator.clipboard is missing on plain-HTTP LAN installs.
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      onNotice(messages.people.inviteCopied);
    } catch {
      const input = document.getElementById(INVITE_LINK_INPUT_ID);
      if (input instanceof HTMLInputElement) input.select();
      onNotice(messages.people.copyInviteManually);
    }
  };
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
                    busy={
                      updateRank.isPending &&
                      updateRank.variables.id === user.id
                    }
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
                    busy={
                      updateRank.isPending &&
                      updateRank.variables.id === user.id
                    }
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
                    onClick={() =>
                      setPendingDelete({ id: user.id, username: user.username })
                    }
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
      {createdInvite ? (
        <div className="invite-link">
          <Field
            id={INVITE_LINK_INPUT_ID}
            label={messages.people.inviteLink}
            hint={messages.people.inviteLinkHint}
            readOnly
            value={createdInvite.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void copyInvite(createdInvite.url)}
          >
            <Copy size={16} /> {messages.people.copyInvite}
          </Button>
        </div>
      ) : null}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  busy={
                    revokeInvite.isPending &&
                    revokeInvite.variables === invite.id
                  }
                  onClick={() => revokeInvite.mutate(invite.id)}
                >
                  {messages.common.revoke}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog
        open={pendingDelete !== undefined}
        title={messages.people.deleteTitle({
          username: pendingDelete?.username ?? "",
        })}
        description={messages.people.deleteDescription}
        onClose={() => {
          if (!deleteUser.isPending) setPendingDelete(undefined);
        }}
        size="sm"
      >
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={deleteUser.isPending}
            onClick={() => setPendingDelete(undefined)}
          >
            {messages.common.cancel}
          </Button>
          <Button
            type="button"
            variant="danger"
            busy={deleteUser.isPending}
            onClick={() => {
              if (pendingDelete) deleteUser.mutate(pendingDelete.id);
            }}
          >
            <Trash2 size={16} /> {messages.common.delete}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
