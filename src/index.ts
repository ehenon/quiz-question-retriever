import { exec } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';
import ollama from 'ollama';

enum AvailableAIModels {
  Llama3 = 'llama3',
  Mistral = 'mistral',
  Phi3 = 'phi3',
}

const CHOSEN_AI = AvailableAIModels.Llama3;

const OUTPUT_FOLDER = './output';
const REPLAY_DOWNLOAD_FOLDER = `${OUTPUT_FOLDER}/1_qpuc_replay`;
const REPLAY_SUBTITLE_FILE_NAME = 'qpuc';
const REPLAY_SUBTITLE_FILE_EXTENSION = '.qsm.vtt';
const REPLAY_SUBTITLE_FILE_PATH = `${REPLAY_DOWNLOAD_FOLDER}/${REPLAY_SUBTITLE_FILE_NAME}${REPLAY_SUBTITLE_FILE_EXTENSION}`;
const PARSED_SUBTITLE_FILE_FOLDER = `${OUTPUT_FOLDER}/2_parsed_subtitles`;
const PARSED_SUBTITLE_FILE_NAME = 'parsed_vtt';
const PARSED_SUBTITLE_FILE_PATH = `${PARSED_SUBTITLE_FILE_FOLDER}/${PARSED_SUBTITLE_FILE_NAME}.txt`;
const HUMAN_READABLE_SUBTITLE_FILE_FOLDER = `${OUTPUT_FOLDER}/3_human_readable_subtitles`;
const HUMAN_READABLE_SUBTITLE_FILE_NAME = 'human_readable_subs';
const HUMAN_READABLE_SUBTITLE_FILE_PATH = `${HUMAN_READABLE_SUBTITLE_FILE_FOLDER}/${HUMAN_READABLE_SUBTITLE_FILE_NAME}.txt`;
const AI_PROMPT_FOLDER = `${OUTPUT_FOLDER}/4_ai_prompt`;
const AI_PROMPT_FILE_NAME = 'prompt';
const AI_PROMPT_FILE_PATH = `${AI_PROMPT_FOLDER}/${AI_PROMPT_FILE_NAME}.txt`;
const AI_OUTPUT_FOLDER = `${OUTPUT_FOLDER}/5_ai_output`;
const AI_OUTPUT_FILE_NAME = 'ai_response';
const AI_OUTPUT_FILE_PATH = `${AI_OUTPUT_FOLDER}/${AI_OUTPUT_FILE_NAME}.txt`;

const getLatestReplayUrl = async (): Promise<string> => {
  try {
    console.log('\n* Getting latest replay URL...');
    const { data: html } = await axios.get('https://www.france.tv/france-3/questions-pour-un-champion');
    const $ = cheerio.load(html);
    const href = $('a.js-program-content-continue-watching').attr('href');
    if (!href) {
      throw new Error('Replay URL not found in HTML content');
    }
    console.log('✓ Latest replay URL successfully retrieved');
    return `https://www.france.tv${href}`;
  } catch (err) {
    console.log(`✗ An error occurred when getting the latest replay URL: ${err}`);
    process.exit(1);
  }
};

const run = async (cmd: string) => new Promise((resolve, reject) => {
  exec(cmd, (error, stdout, stderr) => {
    if (error) return reject(error);
    if (stderr) return reject(stderr);
    return resolve(stdout);
  });
});

const createOutputFolder = async () => {
  try {
    console.log('* Creating output folder...');
    if (!fs.existsSync(OUTPUT_FOLDER)) {
      await fsp.mkdir(OUTPUT_FOLDER);
    }
    console.log('✓ Output folder successfully created');
  } catch (err) {
    console.log(`✗ An error occurred when creating output folder: ${err}`);
    process.exit(1);
  }
};

const downloadReplayFiles = async (replayUrl: string): Promise<void> => {
  try {
    console.log('* Downloading France TV replay files...');
    if (fs.existsSync(REPLAY_SUBTITLE_FILE_PATH)) {
      console.log('✓ France TV replay files already downloaded');
      return;
    }
    await run(`yt-dlp -P "${REPLAY_DOWNLOAD_FOLDER}" -o "${REPLAY_SUBTITLE_FILE_NAME}.%(ext)s" -q --write-subs "${replayUrl}"`);
    console.log('✓ France TV replay files successfully downloaded');
  } catch (err) {
    console.log(`✗ An error occurred when downloading the France TV replay: ${err}`);
    process.exit(1);
  }
};

const parseSubtitleFile = async (filePath: string): Promise<string> => {
  try {
    console.log('* Parsing subtitle file...');
    const inputFileContent = await fsp.readFile(filePath, 'utf-8');
    const inputFileLines = inputFileContent.split('\n');

    let parsedContent = '';
    let startAppending = false;

    inputFileLines.forEach((fileLine) => {
      if (!startAppending && (
        fileLine.startsWith('00:30:')
        || fileLine.startsWith('00:31:')
        || fileLine.startsWith('00:32:')
        || fileLine.startsWith('00:33:')
      )) {
        startAppending = true;
      }
      if (startAppending
        && fileLine.trim() !== ''
        && !fileLine.trim().includes('-->')
        && !/^\d+$/.test(fileLine.trim())) {
        parsedContent += `${fileLine.trim().replace(/<c.white>|<c.magenta>|<c.red>|<c.green>|<c.cyan>|<c.yellow>|france.tv access|<\/c>/g, '')} `;
      }
    });

    if (!fs.existsSync(PARSED_SUBTITLE_FILE_FOLDER)) {
      await fsp.mkdir(PARSED_SUBTITLE_FILE_FOLDER);
    }

    await fsp.writeFile(PARSED_SUBTITLE_FILE_PATH, parsedContent, 'utf-8');
    console.log('✓ Subtitle file successfully parsed');
    return parsedContent;
  } catch (err) {
    console.log(`✗ An error occurred when parsing the subtitle file: ${err}`);
    process.exit(1);
  }
};

const writeHumanReadableSubtitleFile = async (content: string): Promise<void> => {
  try {
    console.log('* Writing human-readable subtitle file...');
    const fileContent = content.replace(/ -/g, '\n- ');

    if (!fs.existsSync(HUMAN_READABLE_SUBTITLE_FILE_FOLDER)) {
      await fsp.mkdir(HUMAN_READABLE_SUBTITLE_FILE_FOLDER);
    }

    await fsp.writeFile(HUMAN_READABLE_SUBTITLE_FILE_PATH, fileContent, 'utf-8');
    console.log('✓ Human-readable subtitle file successfully written');
  } catch (err) {
    console.log(`✗ An error occurred when writing the human-readable subtitle file: ${err}`);
    process.exit(1);
  }
};

const generateAIPrompt = async (parsedSubtitles: string): Promise<string> => {
  try {
    console.log('* Generating AI prompt...');
    const prompt = `Voici un extrait de sous-titres correspondant à la manche de fin d'une émission de jeu TV de quiz, à peu près au moment où la présentation des cadeaux des candidats est en cours. Cette dernière manche oppose deux joueurs qui doivent répondre le plus vite possible à de longues questions posées par le présentateur, autour d'un thème spécifié. Tant qu'une réponse correcte n'est pas donnée, la question continue. J'aimerais que tu extrais, pour chaque question :\n- le libellé entier de la question (si un candidat répond avant la fin de la question, il faut compléter la question avec sa suite, énoncée par le présentateur)\n- le thème de la question\n- la réponse.\n\n\`${parsedSubtitles}\``;
    if (!fs.existsSync(AI_PROMPT_FOLDER)) {
      await fsp.mkdir(AI_PROMPT_FOLDER);
    }
    await fsp.writeFile(AI_PROMPT_FILE_PATH, prompt, 'utf-8');
    console.log('✓ AI prompt successfully generated');
    return prompt;
  } catch (err) {
    console.log(`✗ An error occurred when generating AI prompt: ${err}`);
    process.exit(1);
  }
};

const callAIModel = async (prompt: string): Promise<string> => {
  try {
    console.log('* Calling AI...');
    const response = await ollama.chat({
      model: CHOSEN_AI,
      messages: [{ role: 'user', content: prompt }],
    });
    console.log('✓ AI response successfully retrieved');
    return response.message.content;
  } catch (err) {
    console.log(`✗ An error occurred when calling AI: ${err}`);
    process.exit(1);
  }
};

const writeAIResponse = async (response: string) => {
  try {
    console.log('* Writing AI response output file...');
    if (!fs.existsSync(AI_OUTPUT_FOLDER)) {
      await fsp.mkdir(AI_OUTPUT_FOLDER);
    }
    await fsp.writeFile(AI_OUTPUT_FILE_PATH, response, 'utf-8');
    console.log('✓ AI response output file successfully created');
  } catch (err) {
    console.log(`✗ An error occurred when writing AI response output file: ${err}`);
    process.exit(1);
  }
};

(async () => {
  const replayUrl = await getLatestReplayUrl();
  await createOutputFolder();
  await downloadReplayFiles(replayUrl);
  const parsedSubtitles = await parseSubtitleFile(REPLAY_SUBTITLE_FILE_PATH);
  await writeHumanReadableSubtitleFile(parsedSubtitles);
  const chatPrompt = await generateAIPrompt(parsedSubtitles);
  const aiResponse = await callAIModel(chatPrompt);
  await writeAIResponse(aiResponse);
  process.exit(0);
})();
