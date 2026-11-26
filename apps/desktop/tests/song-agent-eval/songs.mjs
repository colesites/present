// Public-domain hymns as a library would hold them: two lines to a slide,
// labelled by section. Some keep the chorus once, as many libraries do (the
// operator goes back to it); some write it out after every verse.
//
// These are the songs sung in LibriVox's "Hymn Collection 001"
// (archive.org/details/hymn_collection_001_0909_librivox); the recordings
// themselves are listed in `recordings.mjs`. Songs written for this test,
// sung by a synthetic voice, are in `originals.mjs`.

import { ORIGINALS } from "./originals.mjs";
import { slidesOf } from "./slides.mjs";

const song = (id, title, body) => ({ id, title, source: "public domain", slides: slidesOf(body) });

const HYMNS = [
  song("amazing-grace", "Amazing Grace", `
[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!

I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;

How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;

'Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
The Lord has promised good to me,
His Word my hope secures;

He will my shield and portion be,
As long as life endures.

[Verse 5]
Yea, when this flesh and heart shall fail,
And mortal life shall cease,

I shall possess, within the veil,
A life of joy and peace.

[Verse 6]
The earth shall soon dissolve like snow,
The sun forbear to shine;

But God, who called me here below,
Will be forever mine.

[Verse 7]
When we've been there ten thousand years,
Bright shining as the sun,

We've no less days to sing God's praise
Than when we'd first begun.
`),
  song("it-is-well", "It Is Well With My Soul", `
[Verse 1]
When peace, like a river, attendeth my way,
When sorrows like sea billows roll;

Whatever my lot, Thou hast taught me to say,
It is well, it is well with my soul.

[Chorus]
It is well with my soul,
It is well, it is well with my soul.

[Verse 2]
Though Satan should buffet, though trials should come,
Let this blest assurance control,

That Christ has regarded my helpless estate,
And hath shed His own blood for my soul.

[Verse 3]
My sin, oh, the bliss of this glorious thought!
My sin, not in part but the whole,

Is nailed to the cross, and I bear it no more,
Praise the Lord, praise the Lord, O my soul!

[Verse 4]
For me, be it Christ, be it Christ hence to live:
If Jordan above me shall roll,

No pang shall be mine, for in death as in life
Thou wilt whisper Thy peace to my soul.

[Verse 5]
But, Lord, 'tis for Thee, for Thy coming we wait,
The sky, not the grave, is our goal;

Oh, trump of the angel! Oh, voice of the Lord!
Blessed hope, blessed rest of my soul!

[Verse 6]
And Lord, haste the day when my faith shall be sight,
The clouds be rolled back as a scroll;

The trump shall resound, and the Lord shall descend,
Even so, it is well with my soul.
`),
  song("blessed-assurance", "Blessed Assurance", `
[Verse 1]
Blessed assurance, Jesus is mine!
Oh, what a foretaste of glory divine!

Heir of salvation, purchase of God,
Born of His Spirit, washed in His blood.

[Chorus]
This is my story, this is my song,
Praising my Savior all the day long;

This is my story, this is my song,
Praising my Savior all the day long.

[Verse 2]
Perfect submission, perfect delight,
Visions of rapture now burst on my sight;

Angels descending bring from above
Echoes of mercy, whispers of love.

[Chorus]
This is my story, this is my song,
Praising my Savior all the day long;

This is my story, this is my song,
Praising my Savior all the day long.

[Verse 3]
Perfect submission, all is at rest;
I in my Savior am happy and blest,

Watching and waiting, looking above,
Filled with His goodness, lost in His love.

[Chorus]
This is my story, this is my song,
Praising my Savior all the day long;

This is my story, this is my song,
Praising my Savior all the day long.
`),
  song("i-surrender-all", "I Surrender All", `
[Verse 1]
All to Jesus I surrender,
All to Him I freely give;

I will ever love and trust Him,
In His presence daily live.

[Chorus]
I surrender all, I surrender all;
All to Thee, my blessed Savior, I surrender all.

[Verse 2]
All to Jesus I surrender,
Humbly at His feet I bow,

Worldly pleasures all forsaken;
Take me, Jesus, take me now.

[Verse 3]
All to Jesus I surrender,
Make me, Savior, wholly Thine;

Let me feel the Holy Spirit,
Truly know that Thou art mine.

[Verse 4]
All to Jesus I surrender,
Lord, I give myself to Thee;

Fill me with Thy love and power;
Let Thy blessing fall on me.

[Verse 5]
All to Jesus I surrender;
Now I feel the sacred flame.

O the joy of full salvation!
Glory, glory, to His name!
`),
  song("softly-and-tenderly", "Softly and Tenderly", `
[Verse 1]
Softly and tenderly Jesus is calling,
Calling for you and for me;

See, on the portals He's waiting and watching,
Watching for you and for me.

[Chorus]
Come home, come home,
Ye who are weary, come home;

Earnestly, tenderly, Jesus is calling,
Calling, O sinner, come home!

[Verse 2]
Why should we tarry when Jesus is pleading,
Pleading for you and for me?

Why should we linger and heed not His mercies,
Mercies for you and for me?

[Chorus]
Come home, come home,
Ye who are weary, come home;

Earnestly, tenderly, Jesus is calling,
Calling, O sinner, come home!

[Verse 3]
Time is now fleeting, the moments are passing,
Passing from you and from me;

Shadows are gathering, deathbeds are coming,
Coming for you and for me.

[Chorus]
Come home, come home,
Ye who are weary, come home;

Earnestly, tenderly, Jesus is calling,
Calling, O sinner, come home!

[Verse 4]
Oh, for the wonderful love He has promised,
Promised for you and for me!

Though we have sinned, He has mercy and pardon,
Pardon for you and for me.

[Chorus]
Come home, come home,
Ye who are weary, come home;

Earnestly, tenderly, Jesus is calling,
Calling, O sinner, come home!
`),
  song("trust-and-obey", "Trust and Obey", `
[Verse 1]
When we walk with the Lord in the light of His Word,
What a glory He sheds on our way!

While we do His good will, He abides with us still,
And with all who will trust and obey.

[Chorus]
Trust and obey, for there's no other way
To be happy in Jesus, but to trust and obey.

[Verse 2]
Not a shadow can rise, not a cloud in the skies,
But His smile quickly drives it away;

Not a doubt or a fear, not a sigh or a tear,
Can abide while we trust and obey.

[Verse 3]
Not a burden we bear, not a sorrow we share,
But our toil He doth richly repay;

Not a grief or a loss, not a frown or a cross,
But is blest if we trust and obey.

[Verse 4]
But we never can prove the delights of His love
Until all on the altar we lay;

For the favor He shows, for the joy He bestows,
Are for them who will trust and obey.

[Verse 5]
Then in fellowship sweet we will sit at His feet,
Or we'll walk by His side in the way;

What He says we will do, where He sends we will go;
Never fear, only trust and obey.
`),
  song("tis-so-sweet", "'Tis So Sweet to Trust in Jesus", `
[Verse 1]
'Tis so sweet to trust in Jesus,
Just to take Him at His word;

Just to rest upon His promise;
Just to know, "Thus saith the Lord."

[Chorus]
Jesus, Jesus, how I trust Him!
How I've proved Him o'er and o'er!

Jesus, Jesus, precious Jesus!
O for grace to trust Him more!

[Verse 2]
O how sweet to trust in Jesus,
Just to trust His cleansing blood;

Just in simple faith to plunge me
'Neath the healing, cleansing flood!

[Chorus]
Jesus, Jesus, how I trust Him!
How I've proved Him o'er and o'er!

Jesus, Jesus, precious Jesus!
O for grace to trust Him more!

[Verse 3]
Yes, 'tis sweet to trust in Jesus,
Just from sin and self to cease;

Just from Jesus simply taking
Life and rest, and joy and peace.

[Chorus]
Jesus, Jesus, how I trust Him!
How I've proved Him o'er and o'er!

Jesus, Jesus, precious Jesus!
O for grace to trust Him more!

[Verse 4]
I'm so glad I learned to trust Thee,
Precious Jesus, Savior, Friend;

And I know that Thou art with me,
Wilt be with me to the end.

[Chorus]
Jesus, Jesus, how I trust Him!
How I've proved Him o'er and o'er!

Jesus, Jesus, precious Jesus!
O for grace to trust Him more!
`),
  song("rock-of-ages", "Rock of Ages", `
[Verse 1]
Rock of Ages, cleft for me,
Let me hide myself in Thee;

Let the water and the blood,
From Thy wounded side which flowed,

Be of sin the double cure,
Save from wrath and make me pure.

[Verse 2]
Not the labors of my hands
Can fulfill Thy law's demands;

Could my zeal no respite know,
Could my tears forever flow,

All for sin could not atone;
Thou must save, and Thou alone.

[Verse 3]
Nothing in my hand I bring,
Simply to the cross I cling;

Naked, come to Thee for dress;
Helpless, look to Thee for grace;

Foul, I to the fountain fly;
Wash me, Savior, or I die.

[Verse 4]
While I draw this fleeting breath,
When mine eyes shall close in death,

When I soar to worlds unknown,
See Thee on Thy judgment throne,

Rock of Ages, cleft for me,
Let me hide myself in Thee.
`),
];

/** The library the agent is tested against: every song, sung or not. */
export const SONGS = [...HYMNS, ...ORIGINALS];

/** @param {string} id */
export const songById = (id) => {
  const found = SONGS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no song ${id}`);
  return found;
};
