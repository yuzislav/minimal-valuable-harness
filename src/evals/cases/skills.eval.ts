import { EvalSuite } from '../types';

export const skillsEvalSuite: EvalSuite = {
  name: 'Skills Evaluation Suite',
  cases: [
    // --- JOKE SKILL TESTS ---
    {
      name: 'Joke Skill Check - Read and Tell',
      input: 'Read the joke_skill and tell me the joke exactly as it appears.',
      assert: ({ response, toolCalls }) => {
        const readSkillCall = toolCalls.find(call => call.name === 'read_skill');
        if (!readSkillCall) return { passed: false, error: 'read_skill tool was not called' };
        if (!readSkillCall.args.skill_name?.includes('joke')) {
          return { passed: false, error: `Wrong skill name: ${readSkillCall.args.skill_name}` };
        }
        
        // The joke is about a chicken crossing a road
        if (!response.toLowerCase().includes('chicken') && !response.toLowerCase().includes('road')) {
          return { passed: false, error: 'Response does not contain the joke' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Joke Skill Check - Explain',
      input: 'Read the joke_skill and explain why it is funny.',
      assert: ({ response, toolCalls }) => {
        const readSkillCall = toolCalls.find(call => call.name === 'read_skill');
        if (!readSkillCall) return { passed: false, error: 'read_skill tool was not called' };
        if (!readSkillCall.args.skill_name?.includes('joke')) {
          return { passed: false, error: `Wrong skill name: ${readSkillCall.args.skill_name}` };
        }
        
        const lowerRes = response.toLowerCase();
        // Explanation should mention the pun/play on words
        if (!lowerRes.includes('pun') && !lowerRes.includes('play on words') && !lowerRes.includes('meaning')) {
          return { passed: false, error: 'Response does not explain the humor' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Joke Skill Check - Translate',
      input: 'Read the joke_skill and translate the joke into French.',
      assert: ({ response, toolCalls }) => {
        const readSkillCall = toolCalls.find(call => call.name === 'read_skill');
        if (!readSkillCall) return { passed: false, error: 'read_skill tool was not called' };
        if (!readSkillCall.args.skill_name?.includes('joke')) {
          return { passed: false, error: `Wrong skill name: ${readSkillCall.args.skill_name}` };
        }
        
        const lowerRes = response.toLowerCase();
        // Check for French words related to chicken / road
        if (!lowerRes.includes('poulet') && !lowerRes.includes('poule') && !lowerRes.includes('route')) {
          return { passed: false, error: 'Response does not seem to contain French translation of the joke' };
        }
        return { passed: true };
      }
    },

    // --- MORNING ROUTINE SKILL TESTS ---
    {
      name: 'Morning Routine Check - Execute',
      input: 'Execute the morning_routine skill.',
      assert: ({ response, toolCalls }) => {
        // Should call read_skill for morning_routine, then weather for Paris, then read_skill for joke
        const readSkillCalls = toolCalls.filter(call => call.name === 'read_skill');
        if (readSkillCalls.length < 1) return { passed: false, error: 'read_skill tool was not called' };
        
        const weatherCall = toolCalls.find(call => call.name === 'weather');
        if (!weatherCall) return { passed: false, error: 'weather tool was not called' };
        if (!weatherCall.args.cityName?.toLowerCase().includes('paris')) {
          return { passed: false, error: `Weather checked wrong city: ${weatherCall.args.cityName}` };
        }
        
        if (!response.toLowerCase().includes('paris') || !response.toLowerCase().includes('joke')) {
          return { passed: false, error: 'Response does not contain weather in Paris or a joke' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Morning Routine Check - London variant',
      input: 'Read the morning_routine skill. Execute its steps, but instead of Paris, check the weather for London.',
      assert: ({ response, toolCalls }) => {
        const weatherCall = toolCalls.find(call => call.name === 'weather');
        if (!weatherCall) return { passed: false, error: 'weather tool was not called' };
        if (!weatherCall.args.cityName?.toLowerCase().includes('london')) {
          return { passed: false, error: `Weather checked wrong city: ${weatherCall.args.cityName}` };
        }
        
        if (!response.toLowerCase().includes('london')) {
          return { passed: false, error: 'Response does not contain weather in London' };
        }
        return { passed: true };
      }
    },
    {
      name: 'Morning Routine Check - Read Only',
      input: 'Read the morning_routine skill and list out the steps it contains without executing them.',
      assert: ({ response, toolCalls }) => {
        const readSkillCall = toolCalls.find(call => call.name === 'read_skill');
        if (!readSkillCall) return { passed: false, error: 'read_skill tool was not called' };
        
        const weatherCall = toolCalls.find(call => call.name === 'weather');
        if (weatherCall) {
          return { passed: false, error: 'Weather tool was called when it should not have been executed' };
        }
        
        const lowerRes = response.toLowerCase();
        if (!lowerRes.includes('weather') || !lowerRes.includes('paris') || !lowerRes.includes('joke')) {
          return { passed: false, error: 'Response does not list the steps of the routine' };
        }
        return { passed: true };
      }
    }
  ]
};
