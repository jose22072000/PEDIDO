import { PageBackground } from "@/components/background";
import Logo from "@/components/images/logo.png";
export default function DefaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col h-screen">
      <PageBackground />
      <div className="fixed top-0 pt-5 md:pt-10 px-10 flex justify-center md:justify-start w-full">
        <div className="px-8 py-6 rounded-2xl bg-primary backdrop-blur-sm border-2 border-black shadow-lg">
          <div className="w-[150px] md:w-[200px]">
            <img alt="PROCOVAR LOGO" className="w-full h-auto" src={Logo} />
          </div>
        </div>
      </div>
      <main className="container mx-auto max-w-7xl px-4 flex-grow pt-[200px] md:pt-[250px]">
        {children}
      </main>
    </div>
  );
}
