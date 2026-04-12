import dotenv from 'dotenv';

import { GPTService } from '../../src/services/ai/gpt.service';
import {
  CreateTaskPayload,
  TodoistAPIService,
  TodoistTask,
} from '../../src/services/external/todoist-api.service';
import { DirectToolCallDispatcher } from '../../src/services/tools/direct-tool-dispatcher.service';
import { ToolCall, ToolResult } from '../../src/types/tool.types';

dotenv.config();

type SupportedFunctionName =
  | 'add_todoist_task'
  | 'get_todoist_task'
  | 'get_tasks'
  | 'update_todoist_task'
  | 'complete_task'
  | 'delete_todoist_task'
  | 'get_completed_todoist_tasks';

interface TodoistPromptCase {
  id: string;
  prompt: string;
  expectedFunction: SupportedFunctionName;
  category: string;
  requiredEnv?: string[];
}

interface SeedTaskMap {
  readById: TodoistTask;
  readByName: TodoistTask;
  readForIds: TodoistTask;
  updateA: TodoistTask;
  updateB: TodoistTask;
  updateC: TodoistTask;
  updateD: TodoistTask;
  updateE: TodoistTask;
  updateF: TodoistTask;
  updateG: TodoistTask;
  updateH: TodoistTask;
  completeA: TodoistTask;
  completeB: TodoistTask;
  completeC: TodoistTask;
  completeD: TodoistTask;
  completeE: TodoistTask;
  completeF: TodoistTask;
  deleteA: TodoistTask;
  deleteB: TodoistTask;
  deleteC: TodoistTask;
  deleteD: TodoistTask;
  deleteE: TodoistTask;
  deleteF: TodoistTask;
  mixedRead: TodoistTask;
  mixedUpdate: TodoistTask;
  mixedComplete: TodoistTask;
  mixedDelete: TodoistTask;
}

const runIntegrationTests =
  process.env.RUN_INTEGRATION_TESTS === 'true' &&
  !!process.env.OPENAI_API_KEY &&
  !!process.env.TODOIST_API_KEY;

const describeIntegration = runIntegrationTests ? describe : describe.skip;

const hasRequiredEnv = (requiredEnv?: string[]): boolean =>
  !requiredEnv || requiredEnv.every((envName) => !!process.env[envName]);

describeIntegration('Todoist Natural Language Integration Tests', () => {
  const fixtureLabel = 'nl-fixture';
  const fixturePrefix = `[nl-fixture-${Date.now()}]`;
  const startedAtIso = new Date().toISOString();

  let dispatcher: DirectToolCallDispatcher;
  let gptService: GPTService;
  let todoistService: TodoistAPIService;
  let seedTasks: SeedTaskMap;
  let promptCases: TodoistPromptCase[] = [];
  let observedFunctions: string[] = [];
  let executeToolCallsSpy: jest.SpiedFunction<DirectToolCallDispatcher['executeToolCalls']>;

  const createSeedTask = async (
    content: string,
    overrides: Omit<CreateTaskPayload, 'content'> = {},
  ): Promise<TodoistTask> =>
    todoistService.addTask({
      content: `${fixturePrefix} ${content}`,
      labels: [fixtureLabel],
      ...overrides,
    });

  const buildPromptCases = (tasks: SeedTaskMap): TodoistPromptCase[] => {
    const projectId = process.env.TODOIST_TEST_PROJECT_ID;
    const sectionId = process.env.TODOIST_TEST_SECTION_ID;
    const assigneeId = process.env.TODOIST_TEST_ASSIGNEE_ID;

    return [
      {
        id: 'create-01',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Add a Todoist task called "${fixturePrefix} buy oat milk".`,
      },
      {
        id: 'create-02',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Create a task "${fixturePrefix} send the weekly report" for tomorrow.`,
      },
      {
        id: 'create-03',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Please add a task named "${fixturePrefix} book dentist appointment" due on 2026-05-01.`,
      },
      {
        id: 'create-04',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Add a task "${fixturePrefix} join design review" due at 2026-05-01T14:30:00Z.`,
      },
      {
        id: 'create-05',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Create an urgent Todoist task called "${fixturePrefix} pay electricity bill".`,
      },
      {
        id: 'create-06',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Add a task "${fixturePrefix} prep launch notes" with labels ${fixtureLabel} and work.`,
      },
      {
        id: 'create-07',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Create a task "${fixturePrefix} pack passport" and set the description to "Need it for the Tokyo trip".`,
      },
      {
        id: 'create-08',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        prompt: `Add a subtask called "${fixturePrefix} draft API changelog" under task ${tasks.updateA.id}.`,
      },
      {
        id: 'create-09',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        requiredEnv: ['TODOIST_TEST_PROJECT_ID'],
        prompt: `Create a task "${fixturePrefix} review analytics dashboard" in Todoist project ${projectId}.`,
      },
      {
        id: 'create-10',
        category: 'create',
        expectedFunction: 'add_todoist_task',
        requiredEnv: ['TODOIST_TEST_SECTION_ID', 'TODOIST_TEST_ASSIGNEE_ID'],
        prompt: `Add a task "${fixturePrefix} follow up with client" in section ${sectionId} and assign it to user ${assigneeId}.`,
      },
      {
        id: 'read-01',
        category: 'read',
        expectedFunction: 'get_todoist_task',
        prompt: `Show me the Todoist task with ID ${tasks.readById.id}.`,
      },
      {
        id: 'read-02',
        category: 'read',
        expectedFunction: 'get_tasks',
        prompt: `List all of my Todoist tasks with the label ${fixtureLabel}.`,
      },
      {
        id: 'read-03',
        category: 'read',
        expectedFunction: 'get_tasks',
        prompt: `What ${fixtureLabel} tasks are due today in Todoist?`,
      },
      {
        id: 'read-04',
        category: 'read',
        expectedFunction: 'get_tasks',
        prompt: `Show me overdue Todoist tasks tagged ${fixtureLabel}.`,
      },
      {
        id: 'read-05',
        category: 'read',
        expectedFunction: 'get_tasks',
        requiredEnv: ['TODOIST_TEST_PROJECT_ID'],
        prompt: `List the tasks in Todoist project ${projectId}.`,
      },
      {
        id: 'read-06',
        category: 'read',
        expectedFunction: 'get_tasks',
        requiredEnv: ['TODOIST_TEST_SECTION_ID'],
        prompt: `Show me the tasks in Todoist section ${sectionId}.`,
      },
      {
        id: 'read-07',
        category: 'read',
        expectedFunction: 'get_tasks',
        prompt: `Fetch the Todoist tasks with IDs ${tasks.readById.id} and ${tasks.readForIds.id}.`,
      },
      {
        id: 'read-08',
        category: 'read',
        expectedFunction: 'get_tasks',
        prompt: `Find the Todoist task named "${tasks.readByName.content}".`,
      },
      {
        id: 'update-01',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Rename Todoist task ${tasks.updateA.id} to "${fixturePrefix} rewrite onboarding email".`,
      },
      {
        id: 'update-02',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Update Todoist task ${tasks.updateB.id} so the description says "Need to cover rollout risks and next steps".`,
      },
      {
        id: 'update-03',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Reschedule Todoist task ${tasks.updateC.id} to next Monday.`,
      },
      {
        id: 'update-04',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Set the priority of Todoist task ${tasks.updateD.id} to 1.`,
      },
      {
        id: 'update-05',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Add the labels ${fixtureLabel} and finance to Todoist task ${tasks.updateE.id}.`,
      },
      {
        id: 'update-06',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Change the due date of "${tasks.updateF.content}" to 2026-05-15.`,
      },
      {
        id: 'update-07',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        requiredEnv: ['TODOIST_TEST_ASSIGNEE_ID'],
        prompt: `Assign Todoist task ${tasks.updateG.id} to user ${assigneeId}.`,
      },
      {
        id: 'update-08',
        category: 'update',
        expectedFunction: 'update_todoist_task',
        prompt: `Update Todoist task ${tasks.updateH.id} so the title becomes "${fixturePrefix} finalize sprint notes" and the description becomes "Summarize wins, misses, and action items".`,
      },
      {
        id: 'complete-01',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Mark Todoist task ${tasks.completeA.id} as completed.`,
      },
      {
        id: 'complete-02',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Finish the Todoist task called "${tasks.completeB.content}".`,
      },
      {
        id: 'complete-03',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Close task ${tasks.completeC.id} in Todoist.`,
      },
      {
        id: 'complete-04',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Please complete "${tasks.completeD.content}" for me.`,
      },
      {
        id: 'complete-05',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Done with task ${tasks.completeE.id}; mark it finished in Todoist.`,
      },
      {
        id: 'complete-06',
        category: 'complete',
        expectedFunction: 'complete_task',
        prompt: `Can you tick off "${tasks.completeF.content}" in Todoist?`,
      },
      {
        id: 'history-01',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        prompt: 'What Todoist tasks have I completed today?',
      },
      {
        id: 'history-02',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        prompt: 'Show me the Todoist tasks I finished this week.',
      },
      {
        id: 'history-03',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        prompt: `List completed Todoist tasks since ${startedAtIso}.`,
      },
      {
        id: 'history-04',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        requiredEnv: ['TODOIST_TEST_PROJECT_ID'],
        prompt: `Show me completed Todoist tasks in project ${projectId} since ${startedAtIso}.`,
      },
      {
        id: 'history-05',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        prompt: 'Get the last 5 completed Todoist tasks.',
      },
      {
        id: 'history-06',
        category: 'completed-history',
        expectedFunction: 'get_completed_todoist_tasks',
        prompt: 'Show me completed Todoist tasks with an offset of 0 and a limit of 10.',
      },
      {
        id: 'delete-01',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Delete Todoist task ${tasks.deleteA.id}.`,
      },
      {
        id: 'delete-02',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Remove the Todoist task called "${tasks.deleteB.content}" permanently.`,
      },
      {
        id: 'delete-03',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Please delete task ${tasks.deleteC.id} from Todoist.`,
      },
      {
        id: 'delete-04',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Get rid of "${tasks.deleteD.content}" in Todoist.`,
      },
      {
        id: 'delete-05',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Trash Todoist task ${tasks.deleteE.id}.`,
      },
      {
        id: 'delete-06',
        category: 'delete',
        expectedFunction: 'delete_todoist_task',
        prompt: `Remove "${tasks.deleteF.content}" from my task list for good.`,
      },
      {
        id: 'mixed-01',
        category: 'mixed',
        expectedFunction: 'add_todoist_task',
        prompt: `Hey, add "${fixturePrefix} call the bank" to Todoist for Friday and make it priority 2.`,
      },
      {
        id: 'mixed-02',
        category: 'mixed',
        expectedFunction: 'get_tasks',
        prompt: `Quickly show me everything in Todoist tagged ${fixtureLabel}.`,
      },
      {
        id: 'mixed-03',
        category: 'mixed',
        expectedFunction: 'update_todoist_task',
        prompt: `Move "${tasks.mixedUpdate.content}" to tomorrow morning and add a short description that says "Need it before standup".`,
      },
      {
        id: 'mixed-04',
        category: 'mixed',
        expectedFunction: 'complete_task',
        prompt: `I finished "${tasks.mixedComplete.content}" already, can you mark it done in Todoist?`,
      },
      {
        id: 'mixed-05',
        category: 'mixed',
        expectedFunction: 'delete_todoist_task',
        prompt: `I do not need "${tasks.mixedDelete.content}" anymore, delete it from Todoist.`,
      },
      {
        id: 'mixed-06',
        category: 'mixed',
        expectedFunction: 'get_tasks',
        prompt: `Find the Todoist task that says "${tasks.mixedRead.content}".`,
      },
    ];
  };

  beforeAll(async () => {
    todoistService = new TodoistAPIService(process.env.TODOIST_API_KEY!);
    dispatcher = new DirectToolCallDispatcher();
    gptService = new GPTService(dispatcher);

    const originalExecuteToolCalls = dispatcher.executeToolCalls.bind(dispatcher);
    executeToolCallsSpy = jest
      .spyOn(dispatcher, 'executeToolCalls')
      .mockImplementation(async (toolCalls: ToolCall[], userId: string): Promise<ToolResult[]> => {
        observedFunctions = toolCalls.map((toolCall) => toolCall.function.name);
        return originalExecuteToolCalls(toolCalls, userId);
      });

    const [
      readById,
      readByName,
      readForIds,
      updateA,
      updateB,
      updateC,
      updateD,
      updateE,
      updateF,
      updateG,
      updateH,
      completeA,
      completeB,
      completeC,
      completeD,
      completeE,
      completeF,
      deleteA,
      deleteB,
      deleteC,
      deleteD,
      deleteE,
      deleteF,
      mixedRead,
      mixedUpdate,
      mixedComplete,
      mixedDelete,
    ] = await Promise.all([
      createSeedTask('seed read by id', { due_string: 'today' }),
      createSeedTask('seed read by name', { labels: [fixtureLabel, 'read-target'] }),
      createSeedTask('seed read for ids', { due_string: 'tomorrow' }),
      createSeedTask('seed update alpha'),
      createSeedTask('seed update bravo'),
      createSeedTask('seed update charlie'),
      createSeedTask('seed update delta'),
      createSeedTask('seed update echo'),
      createSeedTask('seed update foxtrot'),
      createSeedTask('seed update golf'),
      createSeedTask('seed update hotel'),
      createSeedTask('seed complete alpha'),
      createSeedTask('seed complete bravo'),
      createSeedTask('seed complete charlie'),
      createSeedTask('seed complete delta'),
      createSeedTask('seed complete echo'),
      createSeedTask('seed complete foxtrot'),
      createSeedTask('seed delete alpha'),
      createSeedTask('seed delete bravo'),
      createSeedTask('seed delete charlie'),
      createSeedTask('seed delete delta'),
      createSeedTask('seed delete echo'),
      createSeedTask('seed delete foxtrot'),
      createSeedTask('seed mixed read'),
      createSeedTask('seed mixed update'),
      createSeedTask('seed mixed complete'),
      createSeedTask('seed mixed delete'),
    ]);

    seedTasks = {
      readById,
      readByName,
      readForIds,
      updateA,
      updateB,
      updateC,
      updateD,
      updateE,
      updateF,
      updateG,
      updateH,
      completeA,
      completeB,
      completeC,
      completeD,
      completeE,
      completeF,
      deleteA,
      deleteB,
      deleteC,
      deleteD,
      deleteE,
      deleteF,
      mixedRead,
      mixedUpdate,
      mixedComplete,
      mixedDelete,
    };

    promptCases = buildPromptCases(seedTasks);
  }, 120000);

  afterAll(async () => {
    executeToolCallsSpy?.mockRestore();

    if (!todoistService) {
      return;
    }

    try {
      const openTasks = await todoistService.getTasks();
      const fixtureTasks = openTasks.filter((task) => task.content.startsWith(fixturePrefix));

      await Promise.allSettled(
        fixtureTasks.map(async (task) => {
          await todoistService.deleteTask(task.id);
        }),
      );
    } catch {
      // Best-effort cleanup only. Some tasks may already be deleted or completed.
    }
  }, 120000);

  it(
    'contains exactly 50 structured prompt cases',
    () => {
      expect(promptCases).toHaveLength(50);
      promptCases.forEach((testCase) => {
        expect(testCase.id).toBeTruthy();
        expect(testCase.prompt).toBeTruthy();
        expect(testCase.expectedFunction).toBeTruthy();
        expect(testCase.category).toBeTruthy();
      });
    },
    10000,
  );

  it(
    'runs each Todoist natural language prompt through GPT function calling',
    async () => {
      const failures: string[] = [];

      for (const testCase of promptCases) {
        if (!hasRequiredEnv(testCase.requiredEnv)) {
          continue;
        }

        observedFunctions = [];

        try {
          const response = await gptService.processMessage(testCase.prompt, `integration-${testCase.id}`);

          expect(typeof response).toBe('string');
          expect(response.trim().length).toBeGreaterThan(0);

          if (!observedFunctions.includes(testCase.expectedFunction)) {
            failures.push(
              `${testCase.id} expected ${testCase.expectedFunction} but observed [${observedFunctions.join(', ')}]`,
            );
          }
        } catch (error) {
          failures.push(`${testCase.id} threw ${(error as Error).message}`);
        }
      }

      expect(failures).toEqual([]);
    },
    600000,
  );
});
