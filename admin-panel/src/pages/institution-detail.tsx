import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Loader2,
  Trophy,
  Users,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";

import { institutionsService } from "../services/organization";
import { useUIStore, type BreadcrumbItem } from "../stores/ui-store";
import type { Batch, Subject } from "../types";
import BatchesPage from "./batches";
import CandidatesPage from "./candidates";
import ExamsListPage from "./exams-list";
import QuestionsPage from "./questions";
import ResultsPage from "./results";
import SubjectsPage from "./subjects";

import { FolderCard } from "../components/ui/folder-card";

type Folder = "batches" | "subjects" | "candidates" | "exams" | "results";

export default function InstitutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const restoreFolder = (location.state as { folder?: Folder } | null)?.folder;

  const [activeFolder, setActiveFolder] = useState<Folder | null>(
    restoreFolder ?? null,
  );
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [batchFolder, setBatchFolder] = useState<
    "subjects" | "candidates" | null
  >(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  const setCustomBreadcrumbs = useUIStore((s) => s.setCustomBreadcrumbs);
  const setPageHeaderOverride = useUIStore((s) => s.setPageHeaderOverride);

  const { data: institution, isLoading: instLoading } = useQuery({
    queryKey: ["institutions"],
    queryFn: () => institutionsService.list({ pageSize: 100 }),
    select: (res) => res.data.find((i) => i.id === id),
    enabled: !!id,
  });

  const folders: {
    key: Folder;
    label: string;
    icon: typeof Users;
    variant: "blue" | "emerald" | "amber" | "purple" | "rose" | "indigo";
    description: string;
  }[] = [
    {
      key: "batches",
      label: "Batches",
      icon: UsersRound,
      variant: "blue",
      description: "Academic batches & groups",
    },
    {
      key: "subjects",
      label: "Subjects",
      icon: BookOpen,
      variant: "emerald",
      description: "Course subjects & papers",
    },
    {
      key: "exams",
      label: "Exams",
      icon: ClipboardList,
      variant: "amber",
      description: "Scheduled test papers",
    },
    {
      key: "candidates",
      label: "Candidates",
      icon: Users,
      variant: "purple",
      description: "Registered student list",
    },
    {
      key: "results",
      label: "Results",
      icon: Trophy,
      variant: "rose",
      description: "Exam results & answer sheets",
    },
  ];


  // Publish dynamic full sub-path breadcrumbs and page header override
  useEffect(() => {
    if (!institution) return;

    const crumbs: BreadcrumbItem[] = [
      { label: "Institutions", path: "/institutions" },
      { label: institution.name, path: `/institutions/${institution.id}` },
    ];

    let currentTitle = institution.name;
    let currentSubtitle = `Institution Code: ${institution.code}${
      institution.contactEmail ? ` • ${institution.contactEmail}` : ""
    }`;

    if (activeFolder) {
      const folderLabel =
        folders.find((f) => f.key === activeFolder)?.label ?? activeFolder;
      crumbs.push({ label: folderLabel });
      currentTitle = folderLabel;
      currentSubtitle = `${institution.name} • ${folderLabel} Folder`;
    }

    if (selectedBatch) {
      crumbs.push({ label: selectedBatch.name });
      currentTitle = selectedBatch.name;
      currentSubtitle = `${institution.name} • Batch Details`;
    }

    if (batchFolder) {
      const bFolderLabel =
        batchFolder === "candidates" ? "Candidates" : "Subjects";
      crumbs.push({ label: bFolderLabel });
      currentTitle = bFolderLabel;
      currentSubtitle = `${institution.name} • ${selectedBatch?.name} • ${bFolderLabel}`;
    }

    if (selectedSubject) {
      crumbs.push({ label: selectedSubject.name });
      currentTitle = selectedSubject.name;
      currentSubtitle = `${institution.name} • ${selectedSubject.name} (${selectedSubject.code})`;
    }

    setCustomBreadcrumbs(crumbs);
    setPageHeaderOverride({ title: currentTitle, subtitle: currentSubtitle });
  }, [
    institution,
    activeFolder,
    selectedBatch,
    batchFolder,
    selectedSubject,
    setCustomBreadcrumbs,
    setPageHeaderOverride,
  ]);


  if (instLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!institution) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/institutions")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Institutions
        </Button>
        <p className="text-muted-foreground">Institution not found.</p>
      </div>
    );
  }

  const handleBack = () => {
    if (selectedSubject) {
      setSelectedSubject(null);
    } else if (batchFolder) {
      setBatchFolder(null);
    } else if (selectedBatch) {
      setSelectedBatch(null);
    } else if (activeFolder) {
      setActiveFolder(null);
    } else {
      navigate("/institutions");
    }
  };

  return (
    <div>
      {/* Sticky Back button bar */}
      <div className="sticky top-0 z-10 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-4 md:px-6 py-1 mb-4 bg-muted/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {!activeFolder ? "Back to Institutions" : "Back"}
        </Button>
      </div>

      {/* Folder cards view */}
      {!activeFolder && (
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-2">
            {folders.map((folder) => (
              <FolderCard
                key={folder.key}
                label={folder.label}
                description={folder.description}
                icon={folder.icon}
                variant={folder.variant}
                onClick={() => setActiveFolder(folder.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Folder content - render actual page components with inline onBack prop */}
      {activeFolder === "batches" && (
        <BatchesPage
          institutionId={id}
          hideHeader
          onBack={handleBack}
          batchFolder={batchFolder}
          setBatchFolder={setBatchFolder}
          selectedBatch={selectedBatch}
          setSelectedBatch={setSelectedBatch}
          selectedSubject={selectedSubject}
          setSelectedSubject={setSelectedSubject}
        />
      )}
      {activeFolder === "subjects" && !selectedSubject && (
        <SubjectsPage
          institutionId={id}
          hideHeader
          onBack={handleBack}
          onSelectSubject={setSelectedSubject}
        />
      )}
      {activeFolder === "subjects" && selectedSubject && (
        <QuestionsPage
          subjectId={selectedSubject.id}
          hideHeader
          onBack={handleBack}
        />
      )}
      {activeFolder === "exams" && (
        <ExamsListPage institutionId={id} hideHeader />
      )}
      {activeFolder === "candidates" && (
        <CandidatesPage institutionId={id} hideHeader onBack={handleBack} />
      )}
      {activeFolder === "results" && (
        <ResultsPage institutionId={id} />
      )}
      {activeFolder === "batches" &&
        selectedBatch &&
        batchFolder === "subjects" &&
        selectedSubject && (
          <QuestionsPage
            subjectId={selectedSubject.id}
            batchId={selectedBatch.id}
            hideHeader
            onBack={handleBack}
          />
        )}
    </div>
  );

}
