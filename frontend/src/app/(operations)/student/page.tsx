import type { Metadata } from "next";

import { ProtectedArea } from "@/components/protected-area";
import { StudentDesk } from "@/components/student/student-desk";

export const metadata: Metadata = { title: "Students" };

export default function StudentPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <StudentDesk user={user} />
        </main>
      )}
    </ProtectedArea>
  );
}
