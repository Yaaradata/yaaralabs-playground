'use client';

import Link from 'next/link';
import Header from '../../components/Header';

const audiences = [
  {
    title: 'Leadership',
    description: 'See what AI can and cannot do before you sign off on it, and ask vendors the right questions.',
  },
  {
    title: 'Business & operations',
    description: 'Turn your own workflows into AI use cases, and learn where a model needs a person in the loop.',
  },
  {
    title: 'Tech teams',
    description: 'Go from examples to a trained, tested model, and see the evaluation habits production systems need.',
  },
  {
    title: 'PE firms & portfolio companies',
    description: 'Give operators across the portfolio the same hands-on base to spot and size AI opportunities.',
  },
];

const labSteps = [
  { title: 'Collect', description: 'Gather labelled examples: text, images or documents.' },
  { title: 'Train', description: 'Train a model on them in minutes, right in the browser session.' },
  { title: 'Test', description: 'Try it on new inputs and look at its mistakes, not just its successes.' },
  { title: 'Build', description: 'Use the model in a working prototype and decide when it should hand off.' },
];

const safeguards = [
  'Use only public or synthetic data. Never upload client or personal data.',
  'Uploads are stored in a US-region cloud bucket and may be sent to Google Gemini for AI features.',
  'Your workspace is tied to this browser and is deleted automatically after 7 days.',
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header />

      <main className="pt-16">
        {/* Hero */}
        <section className="pt-20 pb-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-brand mb-4">
              About the playground
            </p>
            <h1 className="font-serif text-4xl md:text-5xl font-normal tracking-tight leading-[1.05] mb-6">
              Where AI fluency becomes <span className="italic text-purple-brand">hands-on.</span>
            </h1>
            <p className="text-lg md:text-xl text-fg/75 max-w-3xl mx-auto leading-relaxed">
              The YaaraLabs Playground is the lab environment used in YaaraLabs cohorts. Participants
              don&apos;t just hear how AI works. They build, train and stress-test it themselves, on
              scenarios drawn from their own industry.
            </p>
          </div>
        </section>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 space-y-16">
          {/* Who it's for */}
          <section>
            <h2 className="font-serif text-2xl md:text-3xl font-normal text-fg mb-6">Who it&apos;s for</h2>
            <div className="grid sm:grid-cols-2 gap-5">
              {audiences.map((a) => (
                <div key={a.title} className="bg-surface border border-fg/10 rounded-xl p-6">
                  <h3 className="text-lg font-bold mb-2">{a.title}</h3>
                  <p className="text-fg/70 leading-relaxed">{a.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* How the labs work */}
          <section>
            <h2 className="font-serif text-2xl md:text-3xl font-normal text-fg mb-6">How the labs work</h2>
            <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {labSteps.map((step, i) => (
                <li key={step.title} className="bg-card border border-fg/10 rounded-xl p-6">
                  <span className="font-serif text-2xl text-purple-brand block mb-3">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                  <p className="text-fg/70 text-sm leading-relaxed">{step.description}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Data */}
          <section className="bg-surface border border-fg/10 rounded-xl p-6 md:p-8">
            <h2 className="font-serif text-2xl font-normal mb-5">Your data in the playground</h2>
            <ul className="space-y-3">
              {safeguards.map((item) => (
                <li key={item} className="flex gap-3 text-fg/80 leading-relaxed">
                  <span className="text-pink-brand font-bold" aria-hidden>
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* CTA */}
          <section className="text-center bg-surface border border-fg/10 rounded-xl px-6 py-12">
            <h2 className="font-serif text-3xl font-normal mb-4">Start building</h2>
            <p className="text-fg/70 mb-8 max-w-xl mx-auto">
              Open the playground and create your first project. No sign-up needed.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/projects"
                className="bg-fg text-canvas px-8 py-4 font-semibold hover:opacity-90 transition-all"
              >
                Open the playground →
              </Link>
              <a
                href="https://www.yaaralabs.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-fg/20 text-fg px-8 py-4 font-semibold hover:bg-card transition-all"
              >
                Visit yaaralabs.ai ↗
              </a>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
