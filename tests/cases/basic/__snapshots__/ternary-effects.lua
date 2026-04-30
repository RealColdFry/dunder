local ____exports = {}
local function statementPos(cond)
    local i = 0
    if cond then
        i = i + 1
    else
        i = i - 1
    end
    return i
end
local function effectfulTrue(cond)
    local i = 0
    local ____ternary_0
    if cond then
        i = i + 1
        ____ternary_0 = i
    else
        ____ternary_0 = i
    end
    local r = ____ternary_0
    return r + i
end
local function effectfulFalse(cond)
    local i = 0
    local ____ternary_1
    if cond then
        ____ternary_1 = i
    else
        i = i + 2
        ____ternary_1 = i
    end
    local r = ____ternary_1
    return r + i
end
local function pure(cond)
    return (function()
        if cond then
            return 1
        else
            return 2
        end
    end)()
end
return ____exports
