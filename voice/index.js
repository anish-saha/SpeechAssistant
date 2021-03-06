"use strict";

var SKILL_STATES = {
    START: "_STARTMODE",
    AENUMERATE: "_AENUMERATEMODE",
    PRACTICE: "_PRACTICEMODE",
    PRACTICEEND: "_PRACTICEENDMODE"
};

var languageString = {
    "en-US": {
        "translation": {
            "SKILL_NAME": "Speech Assistant",
            "OPEN_PROMPT": "Hi, %s here! What do you want to do today?",
            "STOP_MESSAGE": "Good luck with the speech!",
            "UNFOUND_SPEECH": "Sorry, I couldn't find %s, is there another speech you would like to practice?",
            "LOOK_UP": "Let me pull up %s by %s.", 
            "LENGTH_DIFF": "The sentence had %d words, you said %d words.",
            "SENTENCE_DIFF": "You said %s, the sentence was %s. Try again!",
            "SPEECH_FINISH": "You have finished the speech. You made %d mistakes. Would you like to try again?",
            "UNHANDLED_PRACTICE": "Sorry, I couldn't understand that. You're currently on the following sentence %s.",
            "WHAT_CAN_I_SAY": "I can help you memorize a speech, and then provide feedback to help you improve." +
                " Ask me for a list of my speeches, speech authors, or if you’re a returning user, you can specify a speech.",
            "SPEECH_FINISH_NEW_PROMPT": "Okay, we're done with %s. Would you like to practice a different speech?",
            "SPEECH_LOAD_ERR": "Sorry, it looks like an error occurred while loading the speeches.",
            "DATABASE_EMPTY_ERR": "Hi, %s here! It looks like you haven't uploaded any speeches to the database."
        }
    }
};

const Alexa = require("alexa-sdk");
var APP_ID = undefined;
const rp = require("request-promise");
const database = [];

exports.handler = function(event, context, callback) {
    var alexa = Alexa.handler(event, context);
    alexa.appId = APP_ID;
    alexa.resources = languageString;
    alexa.registerHandlers(newSessionHandlers, startStateHandlers, aenumerateStateHandlers, practiceStateHandlers, practiceEndStateHandlers);
    alexa.execute();
};

var newSessionHandlers = {
    "LaunchRequest": function () {
        this.handler.state = SKILL_STATES.START;
        loadDatabase.call(this);
    },
    "Unhandled": function () {
        this.handler.state = SKILL_STATES.START;
        loadDatabase.call(this);
    }
};

function loadDatabase()
{
    // var self = this;
    rp({
        uri: "https://puo6zmuiti.execute-api.us-east-1.amazonaws.com/prod/SpeechUpdate?TableName=SpeechTable",
        json: true
    })
    .catch(error => {
        var speechOutput = this.t("SPEECH_LOAD_ERR");
        this.emit(":tell", speechOutput, speechOutput);
    })
    .then(data =>
    {
        data['Items'].forEach(speech => {
            const name = speech['Title'].toLowerCase();
            database[name] = speech;
        });
        if(Object.keys(database).length != 0) {
            this.emitWithState("Start");
        } else {
            var speechOutput = this.t("DATABASE_EMPTY_ERR", this.t("SKILL_NAME"));
            this.emit(":tell", speechOutput, speechOutput);
        }
    });
}

var startStateHandlers = Alexa.CreateStateHandler(SKILL_STATES.START,{
    "Start": function () {
        var speechOutput = this.t("OPEN_PROMPT", this.t("SKILL_NAME"));
        this.emit(":ask", speechOutput, speechOutput);
    },
    "EnumerateIntent": function() {
        enumerateSpeeches.call(this);
    },
    "PracticeIntent": function() {
        transitionPracticeState.call(this);
    },
    "AuthorEnumerateIntent": function() {
        this.handler.state = SKILL_STATES.AENUMERATE;
        this.emitWithState("Start", false);
    },
    "AMAZON.StartOverIntent": function() {
        this.emitWithState("Start");
    },
    "AMAZON.RepeatIntent": function() {
        this.emitWithState("Start");
    },
    "AMAZON.HelpIntent": function() {
        var speechOutput = this.t("WHAT_CAN_I_SAY");
        this.emit(":ask", speechOutput, speechOutput);
    },
    "AMAZON.StopIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "AMAZON.CancelIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "Unhandled": function() {
        var speechOutput = "I couldn't understand that. " + this.t("OPEN_PROMPT", this.t("SKILL_NAME"));
        this.emit(":ask", speechOutput, speechOutput);
    },
    "SessionEndedRequest": function() {
        console.log("Session ended in state: " + this.event.request.reason);
    }
});

function enumerateSpeeches() {
    var speechOutput = "I have the speeches ";
    var total = Math.min(10, Object.keys(database).length);
    if(total == 1) {
        speechOutput = "I have the speech ";
    }
    var count = 1;
    for(var key in database) {
        if(total == 1) {
            speechOutput += database[key]['Title'] + ".";
        } else if(count > total) {
            break;
        }
        if(count == total) {
            speechOutput += "and " + database[key]['Title'] + ".";
        } else {
            speechOutput += database[key]['Title'] + ", ";
        }
        count += 1;
    }
    this.emit(":ask", speechOutput, speechOutput);
}

function transitionPracticeState() {
    var speechTitle = String(this.event.request.intent.slots.speechName.value).toLowerCase();
    if(speechTitle in database) {
        var speech = database[speechTitle];
        Object.assign(this.attributes, {
            "linePos": 0,
            "lines": speech['Words'].split(/[(\?\.\!\:)]+/).filter(function(e1) {return e1.length!=0;}),
            "author": speech['Author'],
            "title": speechTitle,
            "mistakeCounter": 0
        });
        this.handler.state = SKILL_STATES.PRACTICE;
        this.emitWithState("Start");
    } else {
        var speechOutput = this.t("UNFOUND_SPEECH", speechTitle);
        this.handler.state = SKILL_STATES.START;
        this.emit(":ask", speechOutput, speechOutput);
    }
}

var practiceStateHandlers = Alexa.CreateStateHandler(SKILL_STATES.PRACTICE, {
    "Start": function() {
        var speechOutput = this.t("LOOK_UP", this.attributes['title'], this.attributes['author']);
        speechOutput += " <break time=\"1s\" /> The first sentence is: " + this.attributes['lines'][0];
        this.emit(":ask", speechOutput, speechOutput);
    },
    "SpeakIntent": function() {
        processSpeechInput.call(this);
    },
    "PracticeIntent": function() { // shouldn't happen here, but possible
        processSpeechInput.call(this);
    },
    "AMAZON.RepeatIntent": function() {
        var speechOutput = "You are currently on the following sentence: " + this.attributes['lines'][this.attributes['linePos']];
        this.emit(":ask", speechOutput, speechOutput);
    },
    "Unhandled": function() {
        var speechOutput = this.t("UNHANDLED_PRACTICE", this.attributes['lines'][this.attributes['linePos']]);
        this.emit(":ask", speechOutput, speechOutput);
    },
    "AMAZON.StopIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "AMAZON.CancelIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "SessionEndedRequest": function() {
        console.log("Session ended in state: " + this.event.request.reason);
    }
});

function processSpeechInput() {
    var user = String(this.event.request.intent.slots.freeFormSpeech.value);
    var userWords = user.split(" ").filter(function(e1) {return e1.length!=0;});
    var userLength = userWords.length;

    var pos = this.attributes['linePos'];
    var system = this.attributes['lines'][pos];
    var systemWords = system.split(/[(\ \,\;\:\"\-)]+/).filter(function(e1) {return e1.length!=0;});
    var systemLength = systemWords.length;

    if(userLength != systemLength) {
        var speechOutput = this.t("LENGTH_DIFF", systemLength, userLength);
        speechOutput += " Lets try again! The sentence was " + system;
        this.attributes['mistakeCounter'] = this.attributes['mistakeCounter'] + 1;
        this.emit(":ask", speechOutput, speechOutput);
    } else {
        var words = true;
        for(var i = 0; i < systemLength; i++) {
            var curUserWord = userWords[i];
            if(curUserWord == 1) {
                curUserWord = "one";
            } else if (curUserWord == 2) {
                curUserWord = "two";
            } else if (curUserWord == 3) {
                curUserWord = "three";
            } else if (curUserWord == 4) {
                curUserWord = "four";
            } else if (curUserWord == 5) {
                curUserWord = "five";
            } else if (curUserWord == 6) {
                curUserWord = "six";
            } else if (curUserWord == 7) {
                curUserWord = "seven";
            } else if (curUserWord == 8) {
                curUserWord = "eight";
            } else if (curUserWord == 9) {
                curUserWord = "nine";
            } else if (curUserWord == 10) {
                curUserWord = "ten";
            } else {
                curUserWord = curUserWord.toLowerCase();
            }
            if(curUserWord === systemWords[i].toLowerCase()) {
                continue;
            } else {
                words = false;
            }
        }

        if(words) {
            this.attributes['linePos'] = pos + 1;
            var speechOutput = "Great job! ";
            if(pos + 1 == this.attributes['lines'].length) {
                speechOutput += this.t("SPEECH_FINISH", this.attributes['mistakeCounter']);
                this.handler.state = SKILL_STATES.PRACTICEEND;
                this.attributes['repeat'] = true;
                this.emit(":ask", speechOutput, speechOutput);
            } else {
                speechOutput += "The next sentence is: " + this.attributes['lines'][pos+1];
                this.emit(":ask", speechOutput, speechOutput);
            }
        } else {
            var speechOutput = this.t("SENTENCE_DIFF", user, system);
            this.attributes['mistakeCounter'] = this.attributes['mistakeCounter'] + 1;
            this.emit(":ask", speechOutput, speechOutput);
        }
    }
}

var aenumerateStateHandlers = Alexa.CreateStateHandler(SKILL_STATES.AENUMERATE, {
    "Start": function(failInst) {
        var speechOutput = "";
        if(failInst) {
            speechOutput += "Sorry, I couldn't find any speeches by that author. Please try again. ";
        }
        var speechOutput = "I have speeches by ";
        var total = Math.min(10, Object.keys(database).length);
        if(total == 1) {
            speechOutput = "I have a speech by ";
        }
        var count = 1;
        for(var key in database) {
            if(total == 1) {
                speechOutput += database[key]['Author'] + ".";
            } else if(count > total) {
                break;
            }
            if(count == total) {
                speechOutput += "and " + database[key]['Author'] + ".";
            } else {
                speechOutput += database[key]['Author'] + ", ";
            }
            count += 1;
        }
        this.emit(":ask", speechOutput, speechOutput);
    },
    "AuthorIntent": function() {
        var array = [];
        var author = String(this.event.request.intent.slots.authorName.value).toLowerCase();
        var count = 0;
        for(var key in database) {
            var speech = database[key];
            if(speech['Author'].toLowerCase() === author) {
                array[count] = speech['Title'];
                count += 1;
            }
        }
        var length = Object.keys(array).length
        if(length > 0) {
            var speechOutput = "By " + author + ", I have the ";
            if(length == 1) {
                speechOutput += "speech " + array[0] + ".";
            } else {
                speechOutput += "speeches "
                for(var i = 0; i < length; i++) {
                    if(i == length - 1) {
                        speechOutput += "and " + array[i] + ".";
                    }
                    speechOutput += array[i] + ", ";
                }
            }
            this.emit(":ask", speechOutput, speechOutput);
        } else {
            this.emitWithState("Start", true);
        }
    },
    "SpeakIntent": function() {
        var array = [];
        var author = String(this.event.request.intent.slots.freeFormSpeech.value).toLowerCase();
        var count = 0;
        for(var key in database) {
            var speech = database[key];
            if(speech['Author'].toLowerCase() === author) {
                array[count] = speech['Title'];
                count += 1;
            }
        }
        var length = Object.keys(array).length
        if(length > 0) {
            var speechOutput = "By " + author + ", I have the ";
            if(length == 1) {
                speechOutput += "speech " + array[0] + ".";
            } else {
                speechOutput += "speeches "
                for(var i = 0; i < length; i++) {
                    if(i == length - 1) {
                        speechOutput += "and " + array[i] + ".";
                    }
                    speechOutput += array[i] + ", ";
                }
            }
            this.emit(":ask", speechOutput, speechOutput);
        } else {
            this.emitWithState("Start", true);
        }
    },
    "PracticeIntent": function() {
        transitionPracticeState.call(this);
    },
    "Unhandled": function() {
        var speechOutput = "I couldn't understand that. ";
        var total = Math.min(10, Object.keys(database).length);
        if(total == 1) {
            speechOutput += "I have a speech by ";
        } else {
            speechOutput += "I have speeches by ";
        }
        var count = 1;
        for(var key in database) {
            if(total == 1) {
                speechOutput += database[key]['Author'] + ".";
            } else if(count > total) {
                break;
            }
            if(count == total) {
                speechOutput += "and " + database[key]['Author'] + ".";
            } else {
                speechOutput += database[key]['Author'] + ", ";
            }
            count += 1;
        }
        this.emit(":ask", speechOutput, speechOutput);
    },
    "AMAZON.StopIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "AMAZON.CancelIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "SessionEndedRequest": function() {
        console.log("Session ended in state: " + this.event.request.reason);
    }
});

var practiceEndStateHandlers = Alexa.CreateStateHandler(SKILL_STATES.PRACTICEEND, {
    "AMAZON.YesIntent": function() {
        if(this.attributes['repeat']) { // Would you like to try again
            this.attributes['linePos'] = 0;
            this.handler.state = SKILL_STATES.PRACTICE;
            this.emitWithState("Start");
        } else { // Would you like to practice another speech
            this.handler.state = SKILL_STATES.START;
            this.emitWithState("Start");
        }
    },
    "AMAZON.NoIntent": function() {
        if(this.attributes['repeat']) { // They do not want to try again
            // prompt to see if they want to practice a different speech
            this.attributes['repeat'] = false;
            var speechOutput = this.t("SPEECH_FINISH_NEW_PROMPT", this.attributes['title']);
            this.emit(":ask", speechOutput, speechOutput);
        } else { // they're done, end.
            var speechOutput = "Good work today. Practice on!";
            this.emit(":tell", speechOutput, speechOutput);
        }
    },
    "PracticeIntent": function() { // if they say "i want to practice X" during this state
        this.handler.state = SKILL_STATES.START;
        transitionPracticeState.call(this);
    },
    "Unhandled": function() {
        var speechOutput = "I couldn't understand that. ";
        if(this.attributes['repeat']) {
            speechOutput += "Would you like to try again?";
        } else {
            speechOutput += "Would you like to practice a different speech?";
        }
        this.emit(":ask", speechOutput, speechOutput);
    },
    "AMAZON.StopIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "AMAZON.CancelIntent": function() {
        var speechOutput = this.t("STOP_MESSAGE");
        this.emit(":tell", speechOutput, speechOutput);
    },
    "SessionEndedRequest": function() {
        console.log("Session ended in state: " + this.event.request.reason);
    }
});