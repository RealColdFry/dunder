local ____exports = {}
local function andEffect(cond)
    local i = 0
    local ____and_0 = cond
    if ____and_0 then
        i = i + 1
        ____and_0 = i
    end
    local r = ____and_0
    return r + i
end
local function orEffect(cond)
    local i = 0
    local ____or_1 = cond
    if not ____or_1 then
        i = i + 1
        ____or_1 = i
    end
    local r = ____or_1
    return r + i
end
local function pureAnd(a, b)
    return a and b
end
local function pureOr(a, b)
    return a or b
end
return ____exports
