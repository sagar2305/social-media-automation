import { CreateCreatorForm } from "./create-form";

export default function NewCreatorPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Invite a creator</h1>
        <p className="text-muted-foreground mt-1">
          Add someone the platform should calculate payouts for. UGC creators
          post for your campaigns; team members are the people behind your
          engine-managed accounts (e.g. paying revenue share for the use of
          their TikTok handle).
        </p>
      </div>
      <CreateCreatorForm />
    </div>
  );
}
