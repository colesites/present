import Link from "next/link";

export function CallToAction() {
  return (
    <section className="py-24 px-6 lg:px-12">
      <div className="container mx-auto">
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-primary/80 to-purple-900 border border-white/20 p-12 lg:p-20 shadow-2xl">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1540039155733-d76e6c484947?q=80&w=2000&auto=format&fit=crop')] mix-blend-overlay opacity-30 object-cover" />
            <div className="relative z-10 max-w-2xl">
              <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6">Test drive our products for free!</h2>
              <p className="text-lg text-white/90 mb-10 leading-relaxed font-medium">
                You can have confidence in your purchase. Our software offers fully-functional, free downloads along with free tutorials, user guides and customer support, even before you buy. What do you have to lose?
              </p>
              <Link href="#" className="inline-flex h-14 items-center justify-center rounded-md bg-white px-8 text-base font-bold text-black shadow-lg hover:shadow-xl transition-all hover:scale-105">
                Download Now
              </Link>
            </div>
        </div>
      </div>
    </section>
  );
}
