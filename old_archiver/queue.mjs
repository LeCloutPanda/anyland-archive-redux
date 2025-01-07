import request from 'request';
import { isAreaArchived, createArchiveLog, logFailedArchive, rotateFailedDownloadsLog, rotateRunOutputLog, addArchiveLog, headers } from './utils.mjs';
import { archiveArea, getAreaIdentifiers, getSubAreas } from './area.mjs';

let downloadQueue = [];
let failedAreas = [];
let downloadTimer = null;
const downloadDelay = 1; // How long in seconds between getting each area

/**
 * Manually push new items onto the download queue
 * @param {Array} items
 */
export function appendDownloadQueue(items) {
  downloadQueue = downloadQueue.concat(items);
}

/**
 * Queue a search query
 * Adds all new unique matched areas to the queue, including subareas
 * @param {string} query
 * @returns {Promise}
 */
export function queueSearch(query) {
  return new Promise((resolve, reject) => {
    const options = {
      'method': 'POST',
      'url': 'http://app.anyland.com/area/search',
      'headers': headers,
      form: { 'term': query.toLowerCase() }
    };
    request(options, async function (error, response) {
      let lastAreaId = '';
      try {
        if (error) reject(error);
        if (typeof response === 'undefined' || typeof response.body === 'undefined') reject('Missing body');
        const results = JSON.parse(response.body);
        if (results['error']) reject('Missing body');
        if (typeof results.areas === 'undefined' || typeof results.areas.length === 'undefined') reject('No areas found in response');
        let queueAreas = [];
        for (let i = 0; i < results.areas.length; i++) {
          lastAreaId = results.areas[i].id;
          try {
            if (isAreaArchived(results.areas[i].name, results.areas[i].id) || isInDownloadQueue(results.areas[i].id) || isInFailedAreas(results.areas[i].name)) continue;
            const identifiers = await getAreaIdentifiers(results.areas[i].id, false)
            console.log('Queueing', results.areas[i].name);
            queueAreas.push({
              name: results.areas[i].name,
              id: identifiers.id,
              key: identifiers.key,
              subArea: false,
              parentId: null,
              areaData: identifiers.areaData
            });

            const subAreas = await getSubAreas(identifiers.id);
            if (subAreas.length) {
              queueAreas = queueAreas.concat(subAreas);
              console.log(`Queued ${subAreas.length} new subareas for download.`);
            }
          } catch (e) {
            console.error(e);
            failedAreas.push(results.areas[i].name);
            logFailedArchive(results.areas[i].name, results.areas[i].areaId, results.areas[i].areaKey, e);
          }
        }
        if (queueAreas.length) {
          downloadQueue = downloadQueue.concat(queueAreas);
          console.log(`Queued ${queueAreas.length} new areas for download. Queue contains ${downloadQueue.length} areas`);
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Start the download queue timer, running every X seconds
 * @param {Number} delay in seconds
 */
export function startDownloadQueue(delay = downloadDelay) {
  createArchiveLog();
  rotateRunOutputLog();
  rotateFailedDownloadsLog();
  console.log(`Download queue started with ${delay} second download delay`);
  downloadTimer = setInterval(processQueueStep, 0 * 1);
}

/**
 * Check if a world is in the download queue
 * @param {string} areaId
 * @param {string} areaKey
 * @returns {boolean}
 */
function isInDownloadQueue(areaId) {
  return downloadQueue.some(area =>
    area.areaId === areaId
  );
}

/**
 * Check if a world is in the failed download queue
 * @param {*} areaId
 * @param {*} areaKey
 * @returns {boolean}
 */
function isInFailedAreas(areaName) {
  return failedAreas.some(area =>
    area.areaName === areaName
  );
}

/**
 * Archive the next world in the download queue
 */
async function processQueueStep() {
  if (!downloadQueue.length) return;
  try {
    const areaData = downloadQueue.shift();

    const status = await archiveArea(areaData.name, areaData.id, areaData.key, areaData.areaData);
    if (status.success) {
      console.log(status.msg);
      addArchiveLog(areaData.name, areaData.id, areaData.key, areaData.subArea, areaData.parentId);
    } else {
      failedAreas.push(areaData.name);
      logFailedArchive(areaData.name, areaData.id, areaData.key, status.msg);
    }
  } catch (e) {
    console.log(`Failure logged for ${areaName}`, e.msg);
    failedAreas.push(areaName);
    logFailedArchive(areaName, 'Unobtained', 'Unobtained', e.msg);
  }
}
