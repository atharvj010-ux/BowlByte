import type { Metadata } from "next";

import { PushSettings } from "@/components/notifications/push-settings";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Profile" };

export default function StudentProfilePage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6">
          <p className="eyebrow">Account</p>
          <h1 className="font-display text-5xl font-extrabold tracking-tight uppercase">Profile</h1>
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd data-testid="profile-name">{user.full_name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </dl>
          <PushSettings userId={user.id} />
        </main>
      )}
    </ProtectedArea>
  );
}
