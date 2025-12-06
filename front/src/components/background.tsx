export const PageBackground = () => {
  return (
    <div className="fixed w-full min-h-svh -z-50 bg-gray-100 top-0 left-0 overflow-hidden">
      <div
        aria-hidden="true"
        className="fixed block opacity-100 -bottom-[30%] -left-[30%] -z-40"
      >
        <img
          alt="docs left background"
          className="relative shadow-black/5 shadow-none transition-transform-opacity motion-reduce:transition-none !duration-300 rounded-large"
          src="/images/bg-left.png"
        />
      </div>
      <div
        aria-hidden="true"
        className="fixed block opacity-70 -top-[50%] -right-[60%] 2xl:-top-[60%] 2xl:-right-[45%] -z-30 rotate-12"
      >
        <img
          alt="docs right background"
          className="relative shadow-black/5 shadow-none transition-transform-opacity motion-reduce:transition-none !duration-300 rounded-large"
          src="/images/bg-right.png"
        />
      </div>
      <div className="fixed block top-0 left-0 right-0 bottom-0 bg-white/10 backdrop:blur-md z-0" />
    </div>
  );
};
