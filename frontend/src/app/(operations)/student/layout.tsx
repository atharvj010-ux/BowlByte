import type { ReactNode } from "react";

import { StudentDock } from "@/components/student/student-dock";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pb-20 lg:pb-0">{children}</div>
      <StudentDock />
    </>
  );
}
