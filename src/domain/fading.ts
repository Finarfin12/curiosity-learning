export type HelpLevel = 1 | 2 | 3;

export interface WorkedExample {
  independentProblem: string;
  steps: string[];
  explanation?: string;
}

export function parseWorkedExample(body: string): WorkedExample {
  const [problem, ...lines] = body.split(/\r?\n/);
  if (problem?.startsWith("independent_problem: ")) {
    const explanation = lines.find(line => line.startsWith("ai_explanation: "))?.slice("ai_explanation: ".length);
    return {
      independentProblem: [problem.slice("independent_problem: ".length), ...lines
        .filter(line => line.startsWith("independent_problem_cont: ")).map(line => line.slice("independent_problem_cont: ".length))]
        .join("\n").trim(),
      steps: lines.map(line => line.trim()).filter(line => line && !/^(?:ai_explanation|ai_source|independent_problem_cont): /.test(line)),
      ...(explanation ? { explanation } : {}),
    };
  }
  return { independentProblem: "", steps: body.split(/\r?\n/).map(line => line.trim()).filter(Boolean) };
}

export function visibleExample(example: WorkedExample, level: HelpLevel) {
  return {
    steps: level === 1 ? example.steps : level === 2 ? example.steps.slice(0, -1) : [],
    missingLast: level === 2 && example.steps.length > 0,
    problem: level === 3 ? example.independentProblem : "",
  };
}
