import { exec } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
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
const AI_PROMPT_FOLDER = `${OUTPUT_FOLDER}/3_ai_prompt`;
const AI_PROMPT_FILE_NAME = 'prompt';
const AI_PROMPT_FILE_PATH = `${AI_PROMPT_FOLDER}/${AI_PROMPT_FILE_NAME}.txt`;
const AI_OUTPUT_FOLDER = `${OUTPUT_FOLDER}/4_ai_output`;
const AI_OUTPUT_FILE_NAME = 'ai_response';
const AI_OUTPUT_FILE_PATH = `${AI_OUTPUT_FOLDER}/${AI_OUTPUT_FILE_NAME}.txt`;

const getReplayUrl = (): string => {
  const replayUrl = process.argv[2];
  if (!replayUrl) {
    console.error('\nNo France TV replay URL has been provided as argument');
    process.exit(1);
  }
  return replayUrl;
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
    console.log('\n* Creating output folder...');
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
      if (fileLine.startsWith('00:33:')) {
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

const generateAIPrompt = async (parsedSubtitles: string): Promise<string> => {
  try {
    console.log('* Generating AI prompt...');
    const prompt = `J'ai récupéré un extrait de sous-titres correspondant à la fin d'une émission de jeu télévisé de quiz, à peu près au moment où la présentation des cadeaux des candidats est en cours et où la dernière manche du jeu va bientôt commencer. Cette dernière manche, opposant deux joueurs, consiste à essayer de répondre le plus vite possible à une longue question posée par le présentateur. Lorsqu'une réponse fausse est donnée, la question continue. Lorsqu'une réponse correcte est donnée, le joueur gagne le point et le présentateur continue un peu la question afin de donner tous les éléments d'explication aux téléspectateurs. Avant chaque question, le présentateur annonce un thème, et propose à un candidat de prendre ou de laisser la main en fonction de son attrait pour ce thème. Peux-tu extraire les questions posées par le présentateur en concaténant les bouts de question afin qu'elles soient correctement formatées et complètes ? Lorsqu'une bonne réponse est donnée par un joueur, j'aimerais que les éléments de la suite de la question soient inclus également, pour que la question soit complète comme si personne n'avait trouvé la réponse. J'ai besoin que tu présentes ta réponse sous forme de tableau, avec les données suivantes : le "libellé" de la question, le "thème", et la "réponse". Voici l'extrait de sous-titres :\n\n\`${parsedSubtitles}\``;
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
  const replayUrl = getReplayUrl();
  await createOutputFolder();
  await downloadReplayFiles(replayUrl);
  const parsedSubtitles = await parseSubtitleFile(REPLAY_SUBTITLE_FILE_PATH);
  const chatPrompt = await generateAIPrompt(parsedSubtitles);
  const aiResponse = await callAIModel(chatPrompt);
  await writeAIResponse(aiResponse);
  process.exit(0);
})();
