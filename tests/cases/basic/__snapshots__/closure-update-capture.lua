local ____exports = {}
local fns = {}
do
    local i = 0
    while true do
        do
            local ____i_inner_0 = i
            if not (____i_inner_0 < 3) then
                i = ____i_inner_0
                break
            end
            fns[#fns + 1] = function()
                return ____i_inner_0
            end
        end
        ::____continue_0::
        i = ____i_inner_0
        i = i + 1
    end
end
local ____call_arg_1 = print
____call_arg_1(fns[1]())
local ____call_arg_2 = print
____call_arg_2(fns[2]())
local ____call_arg_3 = print
____call_arg_3(fns[3]())
return ____exports
