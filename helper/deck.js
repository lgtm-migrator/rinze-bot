const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio')

const firebase = require('../helper/firebase');


const tempPath = 'temp'

const gameName = [
    '',
    'カードファイト!! ヴァンガード',
    'Weiß Schwarz',
    'フューチャーカード バディファイト',
    '',
    'Reバース for you'
]

const gamePath = [
    '0',
    'Cardfight-Vanguard',
    'Weib-Schwarz',
    'Future-Card-Buddyfight',
    '4',
    'Rebirth-for-you'
]

const imagePrefix = [
    '',
    'https://s3-ap-northeast-1.amazonaws.com/cf-vanguard.com/wordpress/wp-content/images/cardlist/',
    'https://ws-tcg.com/wordpress/wp-content/images/cardlist/',
    'https://fc-buddyfight.com/wordpress/wp-content/images/card/',
    '',
    'https://s3-ap-northeast-1.amazonaws.com/rebirth-fy.com/wordpress/wp-content/images/cardlist/'
]

async function downloadDeckData(id) {
    let res = await axios.post('https://decklog.bushiroad.com/system/app/api/view/' + id, {},
        {"headers": {"Referer": "https://decklog.bushiroad.com/view/" + id}});

    return res.data;
}

async function downloadCard(type, card, rotate = false, force) {
    const imageTempPath = path.resolve(tempPath, gamePath[type], card.card_number.replace('/', '_') + '.png');

    if (force || !fs.existsSync(imageTempPath)) {
        console.log('Downloading ' + gamePath[type] + ' card ' + card.name);
        let res = await axios.get(imagePrefix[type] + card.img, {responseType: 'arraybuffer'});
        let image = sharp(res.data);

        if (rotate && card.direction === 1) image.rotate(90);

        if (!fs.existsSync(path.dirname(imageTempPath))) {
            fs.mkdirSync(path.dirname(imageTempPath), {recursive: true});
        }

        return image.toFile(imageTempPath);
    } else {
        console.log('Already downloaded, skipping ' + gamePath[type] + ' card ' + card.name);
    }
}

async function downloadDeck(deck, game_title_id, deckImageList) {
    for (let card of deck) {
        // console.log(card.card_kind + ' card ' + card.name + ' X ' + card.num);
        for (let i = 0; i < card.num; i++) deckImageList.push(path.resolve(tempPath, gamePath[game_title_id], card.card_number.replace('/', '_') + '.png'));
        await downloadCard(game_title_id, card, true);
    }
}

async function buildDeckImage(deckImageList, out) {
    for (let i = 1; i < deckImageList.length; i++) {
        let currentImage = path.resolve(tempPath, 'building/row' + parseInt(i / 10) + '.png');
        if (i % 10 === 0) continue;
        if (i % 10 === 1) currentImage = deckImageList[i - 1]
        await joinImageHorizontal(
            currentImage,
            deckImageList[i],
            path.resolve(tempPath, 'building/row' + parseInt(i / 10) + '.png')
        );
    }
    await fs.copyFileSync(path.resolve(tempPath, 'building/row0.png'), out, fs.constants.COPYFILE_FICLONE);
    for (let i = 1; i < deckImageList.length / 10; i++) {
        const currentImage = path.resolve(tempPath, 'building/row' + i + '.png');
        let perImage = out
        if (i === 0) perImage = path.resolve(tempPath, 'building/row0.png');
        await joinImageVertical(
            perImage,
            currentImage,
            out
        );
    }
}

async function joinImageHorizontal(left, right, out) {
    console.log('building ' + out);
    const a = path.resolve(tempPath, 'building/a.png');
    const b = path.resolve(tempPath, 'building/b.png');

    if (!fs.existsSync(path.dirname(a))) {
        fs.mkdirSync(path.dirname(a), {recursive: true});
    }

    await fs.copyFileSync(left, a, fs.constants.COPYFILE_FICLONE);
    await fs.copyFileSync(right, b, fs.constants.COPYFILE_FICLONE);

    const leftData = await sharp(a).metadata();
    const rightData = await sharp(b).metadata();

    const img = await sharp({
        create: {
            width: leftData.width + rightData.width,
            height: Math.max(leftData.height, rightData.height),
            channels: 4,
            background: {r: 0, g: 0, b: 0, alpha: 0}
        }
    }).composite([{
        input: a,
        blend: 'add',
        top: 0,
        left: 0
    }, {
        input: b,
        blend: 'add',
        top: 0,
        left: leftData.width
    }]).toFile(out);

    await fs.unlinkSync(a);
    await fs.unlinkSync(b);

    return img;
}

async function joinImageVertical(up, down, out) {
    console.log('building ' + out);
    const a = path.resolve(tempPath, 'building/a.png');
    const b = path.resolve(tempPath, 'building/b.png');

    if (!fs.existsSync(path.dirname(a))) {
        fs.mkdirSync(path.dirname(a), {recursive: true});
    }

    fs.copyFileSync(up, a, fs.constants.COPYFILE_FICLONE);
    fs.copyFileSync(down, b, fs.constants.COPYFILE_FICLONE);
    const leftData = await sharp(a).metadata();
    const rightData = await sharp(b).metadata();

    const img = await sharp({
        create: {
            width: Math.max(leftData.width, rightData.width),
            height: leftData.height + rightData.height,
            channels: 4,
            background: {r: 0, g: 0, b: 0, alpha: 0}
        }
    }).composite([{
        input: a,
        blend: 'add',
        top: 0,
        left: 0
    }, {
        input: b,
        blend: 'add',
        top: leftData.height,
        left: 0
    }]).toFile(out);

    await fs.unlinkSync(a);
    await fs.unlinkSync(b);

    return img;
}

module.exports = {
    async downloadDeckImage(id) {
        let data = await downloadDeckData(id)
        if (data.deck_id !== undefined) {
            data['gameTitle'] = gameName[data.game_title_id]
            console.log('Found ' + data.gameTitle + ' deck ' + data.title);
            console.log('Deck list :');
            let deckImageList = [];
            await downloadDeck(data.list, data.game_title_id, deckImageList);
            let subDeckImageList = [];
            if (data.sub_list.length > 0) {
                console.log('Sub deck list :');
                await downloadDeck(data.sub_list, data.game_title_id, subDeckImageList);
            }
            await buildDeckImage(deckImageList, 'deck-' + id.toUpperCase() + '.png');
            console.log('uploading image...');
            let deck = await firebase.storage().upload('deck-' + id.toUpperCase() + '.png', {
                destination: 'deck/deck-' + id.toUpperCase() + '.png',
            })
            await deck[0].makePublic();
            data['deckImageUrl'] = deck[0].publicUrl()
            if (subDeckImageList.length > 0) {
                await buildDeckImage(subDeckImageList, 'subDeck-' + id.toUpperCase() + '.png');
                let subDeck = await firebase.storage().upload('subDeck-' + id.toUpperCase() + '.png', {
                    destination: 'deck/subDeck-' + id.toUpperCase() + '.png',
                })
                await subDeck[0].makePublic()
                data['subDeckImageUrl'] = subDeck[0].publicUrl()
            }
            return data
            // await fs.unlinkSync(path.resolve(tempPath, 'building'));
        } else {
            throw 'Deck ' + id + ' not found!';
        }
    },
    async getWsCardDetail(id) {
        const res = await axios.get("https://ws-tcg.com/cardlist/?cardno=" + id)

        const page = cheerio.load(res.data);

        const cardDataTable = page('.card-detail-table tbody tr');

        let side = '';
        const sideImage = cardDataTable.eq(5).find('td').eq(0).find('img').eq(0).attr('src');
        if (sideImage.endsWith('w.gif')) side = 'Weiß';
        else if (sideImage.endsWith('s.gif')) side = 'Schwarz';

        let cardType = '';
        const cardTypeRaw = cardDataTable.eq(5).find('td').eq(1).text();
        if (cardTypeRaw === 'キャラ') cardType = 'Character';
        else if (cardTypeRaw === 'イベント') cardType = 'Event';
        else if (cardTypeRaw === 'クライマックス') cardType = 'Climax';

        const colorImage = cardDataTable.eq(6).find('td').eq(0).find('img').eq(0).attr('src').split('/');
        let color = colorImage[colorImage.length - 1].split('.')[0];
        color = color.charAt(0).toUpperCase() + color.slice(1);

        const triggers = [];
        const triggerImage = cardDataTable.eq(8).find('td').eq(1).find('img');
        for (let i = 0; i < triggerImage.length; i++) {
            const img = triggerImage.eq(i).attr('src').split('/');
            const trigger = img[img.length - 1].split('.')[0];
            triggers.push(trigger.charAt(0).toUpperCase() + trigger.slice(1));
        }

        let specialAttributes = [];
        const specialAttribute = cardDataTable.eq(9).find('td').eq(0).text();
        if (specialAttribute !== '-') specialAttributes = specialAttribute.split('・');

        cardDataTable.eq(10).find('td').eq(0).find('br').replaceWith('\n');
        cardDataTable.eq(11).find('td').eq(0).find('br').replaceWith('\n');

        return {
            'cardName': cardDataTable.eq(0).find('td').eq(1).contents().first().text(),
            'cardNameKana': cardDataTable.eq(0).find('.kana').text(),
            'cardNo': cardDataTable.eq(1).find('td').eq(0).text(),
            'image': 'https://ws-tcg.com' + page('.graphic').find('img').eq(0).attr('src'),
            'packName': cardDataTable.eq(2).find('td').eq(0).text(),
            'newStandardType': cardDataTable.eq(3).find('td').eq(0).text(),
            'seriesId': cardDataTable.eq(4).find('td').eq(0).text(),
            'rarity': cardDataTable.eq(4).find('td').eq(1).text(),
            'side': side,
            'cardType': cardType,
            'color': color,
            'level': cardDataTable.eq(6).find('td').eq(1).text() === '-' ? 0 : parseInt(cardDataTable.eq(6).find('td').eq(1).text(), 10),
            'cost': cardDataTable.eq(7).find('td').eq(0).text() === '-' ? 0 : parseInt(cardDataTable.eq(7).find('td').eq(0).text(), 10),
            'power': cardDataTable.eq(7).find('td').eq(1).text() === '-' ? 0 : parseInt(cardDataTable.eq(7).find('td').eq(1).text(), 10),
            'soul': cardDataTable.eq(8).find('td').eq(0).find('img').length,
            'trigger': triggers,
            'specialAttribute': specialAttributes,
            'text': cardDataTable.eq(10).find('td').eq(0).text().replace('（：', '（トリガー：'),
            'flavorText': cardDataTable.eq(11).find('td').eq(0).text() === '-' ? '' : cardDataTable.eq(11).find('td').eq(0).text(),
            'Illustrator': cardDataTable.eq(12).find('td').eq(0).text()
        };
    }
}
